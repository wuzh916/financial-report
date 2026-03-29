import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import { mkdirSync } from 'fs';
import { v4 as uuid } from 'uuid';
import * as store from '../services/store.js';
import { deleteCacheByPrefix } from '../services/cache.js';
import {
  analyzeSampleDocument,
  getDocxHtmlFromBuffer,
  renderTemplateBuffer,
} from '../services/docx-parser.js';
import { VariableDraft } from '../types.js';

const router = Router();

const uploadsDir = path.resolve(process.cwd(), 'uploads');
mkdirSync(uploadsDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadsDir,
    filename: (_req, file, callback) => {
      callback(null, `${uuid()}${path.extname(file.originalname)}`);
    },
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
});

router.get('/', (_req: Request, res: Response) => {
  try {
    res.json(store.listTemplates());
  } catch (error) {
    console.error('List templates failed:', error);
    res.status(500).json({ error: '获取模板列表失败' });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    let template = store.getTemplate(req.params.id);
    if (!template) {
      return res.status(404).json({ error: '模板不存在' });
    }

    const needsStructureRefresh =
      Boolean(template.sourceDocPath) &&
      (template.paragraphs.some((paragraph) => paragraph.inTable && !paragraph.tableId) ||
        /^新建模板(?:\s*\d+)?$/.test(template.name.trim()));

    if (needsStructureRefresh) {
      try {
        const analysis = await analyzeSampleDocument(req.params.id, template.sourceDocPath);
        template =
          store.replaceTemplateDocument(
            req.params.id,
            template.sourceDocPath,
            analysis.paragraphs.map((paragraph) => ({
              ...paragraph,
              templateId: req.params.id,
            })),
            analysis.candidates
          ) ?? template;
      } catch (refreshError) {
        console.warn(`Skip template structure refresh for ${req.params.id}:`, refreshError);
      }
    }

    res.json(template);
  } catch (error) {
    console.error('Get template failed:', error);
    res.status(500).json({ error: '获取模板失败' });
  }
});

router.post('/', (req: Request, res: Response) => {
  try {
    const { name, category, description, periodType } = req.body;
    if (!name?.trim()) {
      return res.status(400).json({ error: '模板名称不能为空' });
    }

    const template = store.createTemplate({
      name: name.trim(),
      category,
      description,
      periodType,
    });

    res.status(201).json(template);
  } catch (error) {
    console.error('Create template failed:', error);
    res.status(500).json({ error: '创建模板失败' });
  }
});

router.put('/:id', (req: Request, res: Response) => {
  try {
    const template = store.updateTemplateBasics(req.params.id, req.body);
    if (!template) {
      return res.status(404).json({ error: '模板不存在' });
    }
    res.json(template);
  } catch (error) {
    console.error('Update template failed:', error);
    res.status(500).json({ error: '更新模板失败' });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    store.deleteTemplate(req.params.id);
    await deleteCacheByPrefix(`report:payload:${req.params.id}:`);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete template failed:', error);
    res.status(500).json({ error: '删除模板失败' });
  }
});

router.post('/:id/sample', upload.single('document'), async (req: Request, res: Response) => {
  try {
    const template = store.getTemplate(req.params.id);
    if (!template) {
      return res.status(404).json({ error: '模板不存在' });
    }
    if (!req.file) {
      return res.status(400).json({ error: '请上传 .docx 文档' });
    }

    const analysis = await analyzeSampleDocument(req.params.id, req.file.path);
    const updatedTemplate = store.replaceTemplateDocument(
      req.params.id,
      req.file.path,
      analysis.paragraphs.map((paragraph) => ({
        ...paragraph,
        templateId: req.params.id,
      })),
      analysis.candidates
    );

    res.json({
      template: updatedTemplate,
      candidatesCount: analysis.candidates.length,
      paragraphsCount: analysis.paragraphs.length,
    });
  } catch (error) {
    console.error('Upload sample failed:', error);
    res.status(500).json({ error: '上传样本报告失败' });
  }
});

router.get('/:id/preview', async (req: Request, res: Response) => {
  try {
    const template = store.getTemplate(req.params.id);
    if (!template) {
      return res.status(404).json({ error: '模板不存在' });
    }
    if (!template.sourceDocPath) {
      return res.status(400).json({ error: '请先上传样本报告' });
    }

    const buffer = await renderTemplateBuffer(template.sourceDocPath, template.paragraphs, {});
    const html = await getDocxHtmlFromBuffer(buffer);
    res.json({ html, variables: template.variables, candidates: template.candidates });
  } catch (error) {
    console.error('Template preview failed:', error);
    res.status(500).json({ error: '生成模板预览失败' });
  }
});

router.post('/:id/variables', (req: Request, res: Response) => {
  try {
    const template = store.getTemplate(req.params.id);
    if (!template) {
      return res.status(404).json({ error: '模板不存在' });
    }

    const variables = Array.isArray(req.body.variables) ? (req.body.variables as VariableDraft[]) : null;
    if (!variables) {
      return res.status(400).json({ error: 'variables 必须是数组' });
    }

    const keySet = new Set<string>();
    const candidateSet = new Set<string>();

    for (const variable of variables) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(variable.key)) {
        return res.status(400).json({ error: `变量名无效: ${variable.key}` });
      }
      if (keySet.has(variable.key)) {
        return res.status(400).json({ error: `变量名重复: ${variable.key}` });
      }
      keySet.add(variable.key);

      if (variable.candidateId) {
        if (candidateSet.has(variable.candidateId)) {
          return res.status(400).json({ error: '同一个候选值不能映射多个变量' });
        }
        candidateSet.add(variable.candidateId);
      }
    }

    const updatedTemplate = store.replaceTemplateVariables(req.params.id, variables);
    res.json(updatedTemplate);
  } catch (error) {
    console.error('Save variables failed:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : '保存变量失败' });
  }
});

router.post('/:id/variables/manual', (req: Request, res: Response) => {
  try {
    const { sourceText, key, label, jsonPath } = req.body;
    if (!sourceText?.trim() || !key?.trim() || !label?.trim()) {
      return res.status(400).json({ error: 'sourceText、key、label 不能为空' });
    }

    const updatedTemplate = store.addManualVariable(req.params.id, {
      sourceText,
      key,
      label,
      jsonPath,
    });

    if (!updatedTemplate) {
      return res.status(404).json({ error: '模板不存在' });
    }

    res.json(updatedTemplate);
  } catch (error) {
    console.error('Add manual variable failed:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : '添加手动变量失败' });
  }
});

router.put('/:id/paragraphs/:paragraphId', (req: Request, res: Response) => {
  try {
    const templateText = String(req.body.templateText ?? '');
    const updatedTemplate = store.updateParagraphTemplateText(req.params.id, req.params.paragraphId, templateText);
    if (!updatedTemplate) {
      return res.status(404).json({ error: '模板不存在' });
    }
    res.json(updatedTemplate);
  } catch (error) {
    console.error('Update paragraph failed:', error);
    res.status(500).json({ error: '更新文案失败' });
  }
});

router.get('/:id/connector', (req: Request, res: Response) => {
  try {
    const template = store.getTemplate(req.params.id);
    if (!template) {
      return res.status(404).json({ error: '模板不存在' });
    }
    res.json(template.connector);
  } catch (error) {
    console.error('Get connector failed:', error);
    res.status(500).json({ error: '获取接口配置失败' });
  }
});

router.put('/:id/connector', async (req: Request, res: Response) => {
  try {
    const template = store.getTemplate(req.params.id);
    if (!template) {
      return res.status(404).json({ error: '模板不存在' });
    }
    const connector = store.upsertConnector(req.params.id, req.body);
    store.deleteFetchedSnapshots(req.params.id);
    await deleteCacheByPrefix(`report:payload:${req.params.id}:`);
    res.json(connector);
  } catch (error) {
    console.error('Save connector failed:', error);
    res.status(500).json({ error: '保存接口配置失败' });
  }
});

router.get('/:id/snapshots', (req: Request, res: Response) => {
  try {
    res.json(store.listSnapshots(req.params.id));
  } catch (error) {
    console.error('List snapshots failed:', error);
    res.status(500).json({ error: '获取模拟数据失败' });
  }
});

router.post('/:id/snapshots', async (req: Request, res: Response) => {
  try {
    const { periodKey, periodLabel, payload, sourceKind } = req.body;
    if (!periodKey?.trim()) {
      return res.status(400).json({ error: 'periodKey 不能为空' });
    }
    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({ error: 'payload 必须是 JSON 对象' });
    }

    const snapshot = store.upsertSnapshot({
      templateId: req.params.id,
      periodKey,
      periodLabel: periodLabel || periodKey,
      payload,
      sourceKind: sourceKind === 'fetched' ? 'fetched' : 'mock',
    });

    await deleteCacheByPrefix(`report:payload:${req.params.id}:${periodKey}`);
    res.status(201).json(snapshot);
  } catch (error) {
    console.error('Create snapshot failed:', error);
    res.status(500).json({ error: '保存模拟数据失败' });
  }
});

router.put('/:id/snapshots/:snapshotId', async (req: Request, res: Response) => {
  try {
    const { periodKey, periodLabel, payload, sourceKind } = req.body;
    if (!periodKey?.trim()) {
      return res.status(400).json({ error: 'periodKey 不能为空' });
    }
    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({ error: 'payload 必须是 JSON 对象' });
    }

    const snapshot = store.upsertSnapshot({
      id: req.params.snapshotId,
      templateId: req.params.id,
      periodKey,
      periodLabel: periodLabel || periodKey,
      payload,
      sourceKind: sourceKind === 'fetched' ? 'fetched' : 'mock',
    });

    await deleteCacheByPrefix(`report:payload:${req.params.id}:${periodKey}`);
    res.json(snapshot);
  } catch (error) {
    console.error('Update snapshot failed:', error);
    res.status(500).json({ error: '更新模拟数据失败' });
  }
});

router.delete('/:id/snapshots/:snapshotId', async (req: Request, res: Response) => {
  try {
    store.deleteSnapshot(req.params.id, req.params.snapshotId);
    await deleteCacheByPrefix(`report:payload:${req.params.id}:`);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete snapshot failed:', error);
    res.status(500).json({ error: '删除模拟数据失败' });
  }
});

export default router;

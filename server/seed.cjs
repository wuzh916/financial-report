const JSZip = require('jszip');
const fs = require('fs');
const path = require('path');
const http = require('http');

const BASE = 'http://localhost:3001/api';

function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const isJson = body && typeof body === 'object';
    const data = isJson ? JSON.stringify(body) : '';
    const options = {
      hostname: 'localhost', port: 3001,
      path: `/api${urlPath}`, method,
      headers: {},
    };
    if (isJson) {
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(data);
    }
    const req = http.request(options, res => {
      let chunks = '';
      res.on('data', c => chunks += c);
      res.on('end', () => { try { resolve(JSON.parse(chunks)); } catch { resolve(chunks); } });
    });
    req.on('error', reject);
    if (isJson) req.write(data);
    req.end();
  });
}

const post = (url, body) => request('POST', url, body);
const del = (url) => request('DELETE', url);
const get = (url) => request('GET', url);

function postForm(url, filePath) {
  return new Promise((resolve, reject) => {
    const boundary = '----FormBoundary' + Date.now();
    const fileData = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);
    const prefix = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="${fileName}"\r\nContent-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document\r\n\r\n`);
    const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([prefix, fileData, suffix]);
    const req = http.request({ hostname: 'localhost', port: 3001, path: `/api${url}`, method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length }
    }, res => {
      let chunks = '';
      res.on('data', c => chunks += c);
      res.on('end', () => { try { resolve(JSON.parse(chunks)); } catch { resolve(chunks); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Variable mapping config
const VARIABLE_MAP = {
  Total_Assets: { label: '总资产(亿元)', jsonPath: 'summary.totalAssets' },
  Net_Assets: { label: '净资产(亿元)', jsonPath: 'summary.netAssets' },
  Revenue: { label: '营业收入(亿元)', jsonPath: 'summary.revenue' },
  Net_Profit: { label: '净利润(亿元)', jsonPath: 'summary.netProfit' },
  Premium_Total: { label: '保费收入(亿元)', jsonPath: 'premium.total' },
  Auto_Premium: { label: '车险保费(亿元)', jsonPath: 'premium.auto' },
  Agricultural_Premium: { label: '农险保费(亿元)', jsonPath: 'premium.agricultural' },
  Health_Premium: { label: '健康险保费(亿元)', jsonPath: 'premium.health' },
  Combined_Ratio: { label: '综合成本率', jsonPath: 'cost.combinedRatio' },
  Expense_Ratio: { label: '综合费用率', jsonPath: 'cost.expenseRatio' },
  Claims_Ratio: { label: '赔付率', jsonPath: 'cost.claimsRatio' },
  Underwriting_Profit: { label: '承保利润(亿元)', jsonPath: 'cost.underwritingProfit' },
  Investment_Income: { label: '投资收益(亿元)', jsonPath: 'investment.netIncome' },
  Solvency_Comprehensive: { label: '综合偿付能力充足率', jsonPath: 'solvency.comprehensiveRatio' },
  Solvency_Core: { label: '核心偿付能力充足率', jsonPath: 'solvency.coreRatio' },
  Cashflow_Operating: { label: '经营现金流(亿元)', jsonPath: 'cashflow.operating' },
};

async function main() {
  console.log('=== 初始化真实报告模板 ===\n');

  // 0. Clean
  console.log('0. 清理旧数据...');
  const old = await get('/templates');
  for (const t of (Array.isArray(old) ? old : [])) {
    await del(`/templates/${t.id}`);
    console.log(`   已删除: ${t.name}`);
  }

  // 1. Create template
  console.log('\n1. 创建模板...');
  const tpl = await post('/templates', {
    name: '中华财险年度财务决算报告',
    category: 'annual',
    description: '基于真实中华财险2024年度财务决算报告创建的模板，已将关键财务数据替换为可配置变量',
    periodType: 'annual',
  });
  console.log(`   模板ID: ${tpl.id}`);

  // 2. Upload the real report template (with {{variables}} injected)
  const templatePath = path.resolve(__dirname, 'template-real.docx');
  if (!fs.existsSync(templatePath)) {
    console.error('   模板文件不存在，请先运行创建脚本');
    process.exit(1);
  }
  console.log('\n2. 上传真实报告模板...');
  console.log(`   文件: ${templatePath} (${(fs.statSync(templatePath).size / 1024).toFixed(1)} KB)`);
  const uploadResult = await postForm(`/templates/${tpl.id}/upload`, templatePath);
  console.log(`   解析到 ${uploadResult.variablesCount} 个变量`);
  if (uploadResult.variablesCount === 0) {
    console.error('   错误: 未解析到变量!');
    process.exit(1);
  }
  console.log(`   变量: ${uploadResult.template.variables.map(v => v.name).join(', ')}`);

  // 3. Configure variable mappings
  console.log('\n3. 配置变量映射...');
  const variables = uploadResult.template.variables.map(v => ({
    name: v.name,
    label: VARIABLE_MAP[v.name]?.label || v.name,
    jsonPath: VARIABLE_MAP[v.name]?.jsonPath || '',
  }));
  await post(`/templates/${tpl.id}/mapping`, { variables });
  const mapped = variables.filter(v => v.jsonPath).length;
  console.log(`   已映射 ${mapped}/${variables.length} 个变量`);

  // 4. Add data sources
  console.log('\n4. 添加数据源...');
  await post(`/templates/${tpl.id}/datasources`, {
    period: '2024', periodLabel: '2024年度', isDefault: true,
    apiData: {
      summary: { totalAssets: '806.55', netAssets: '179.40', revenue: '631.86', netProfit: '9.51' },
      premium: { total: '681.18', auto: '293.23', agricultural: '180.81', health: '133.15' },
      cost: { combinedRatio: '99.28%', expenseRatio: '23.04%', claimsRatio: '76.24%', underwritingProfit: '4.52' },
      investment: { netIncome: '6.66' },
      solvency: { comprehensiveRatio: '227.84%', coreRatio: '137.37%' },
      cashflow: { operating: '8.21' },
    },
  });
  console.log('   2024年度数据源 ✓');

  await post(`/templates/${tpl.id}/datasources`, {
    period: '2023', periodLabel: '2023年度', isDefault: false,
    apiData: {
      summary: { totalAssets: '729.06', netAssets: '184.20', revenue: '590.65', netProfit: '6.73' },
      premium: { total: '652.45', auto: '281.98', agricultural: '166.01', health: '128.58' },
      cost: { combinedRatio: '100.36%', expenseRatio: '26.08%', claimsRatio: '74.28%', underwritingProfit: '-2.13' },
      investment: { netIncome: '8.55' },
      solvency: { comprehensiveRatio: '196.57%', coreRatio: '156.12%' },
      cashflow: { operating: '-10.05' },
    },
  });
  console.log('   2023年度数据源 ✓');

  // 5. Verify render
  console.log('\n5. 验证报告渲染...');
  const render2024 = await post('/reports/render', { templateId: tpl.id, period: '2024' });
  const ok2024 = render2024.html.includes('806.55') && !render2024.html.includes('{{Total_Assets}}');
  console.log(`   2024渲染: ${ok2024 ? '通过' : '失败'} (${render2024.html.length} chars)`);

  const render2023 = await post('/reports/render', { templateId: tpl.id, period: '2023' });
  const ok2023 = render2023.html.includes('729.06') && render2023.html.includes('6.73');
  console.log(`   2023渲染: ${ok2023 ? '通过' : '失败'} (${render2023.html.length} chars)`);

  // 6. Verify export
  const expSize = await new Promise((resolve) => {
    http.get(`http://localhost:3001/api/reports/${tpl.id}/export?period=2024`, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).length));
    });
  });
  console.log(`   导出: ${expSize} bytes`);

  console.log('\n=== 完成 ===');
  console.log(`模板: ${tpl.name}`);
  console.log(`变量: ${variables.length} 个 (${mapped} 已映射)`);
  console.log(`数据源: 2024年度, 2023年度`);
  console.log(`\nhttp://localhost:5173`);
}

main().catch(err => { console.error('FAILED:', err.message); process.exit(1); });

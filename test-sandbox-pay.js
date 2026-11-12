// 端到端沙箱付款体验测试
const fs = require('fs');
const path = require('path');

// 加载 .env
const envFile = path.resolve('d:\\document\\temp_20261112_01\\期末刷题站\\finals-quiz\\dist\\.env');
const envContent = fs.readFileSync(envFile, 'utf8');
envContent.split('\n').forEach(line => {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
});

const { AlipaySdk } = require('alipay-sdk');

const sdk = new AlipaySdk({
  appId: process.env.ALIPAY_APP_ID,
  privateKey: process.env.ALIPAY_PRIVATE_KEY,
  alipayPublicKey: process.env.ALIPAY_ALIPAY_PUBLIC_KEY,
  gateway: process.env.ALIPAY_GATEWAY,
  signType: 'RSA2',
  keyType: 'PKCS1'
});

const outTradeNo = 'fqtest' + Date.now();
const html = sdk.pageExec('alipay.trade.page.pay', 'POST', {
  bizContent: {
    out_trade_no: outTradeNo,
    total_amount: '0.01',
    subject: '期末刷题站·冲刺报告（沙箱测试）',
    product_code: 'FAST_INSTANT_TRADE_PAY'
  }
});

console.log('✅ pageExec 成功');
console.log('   out_trade_no:', outTradeNo);
console.log('   HTML 长度:', html.length, '字节');
console.log('   HTML 有 form:', html.includes('<form'));
console.log('   HTML 有 submit():', html.includes('submit()'));

// 包装成自动提交的测试页
const wrapper = '<!DOCTYPE html>\n<html><head><meta charset="utf-8"><title>支付宝收银台跳转</title></head>\n' +
  '<body>\n' +
  '<h2>期末刷题站 · 沙箱付款测试</h2>\n' +
  '<p>订单号: <code>' + outTradeNo + '</code></p>\n' +
  '<p>金额: 0.01 元（测试用）</p>\n' +
  '<p>正在跳转到支付宝沙箱收银台...</p>\n' +
  html + '\n<script>document.forms[0].submit();</script>\n</body></html>';

const testPage = path.join('d:\\trae\\temp_20261112_01', 'sandbox-pay.html');
fs.writeFileSync(testPage, wrapper);
console.log('\n✅ 测试页已生成:', testPage);
console.log('   浏览器打开这个文件 → 自动跳转沙箱收银台 → 付款即可');

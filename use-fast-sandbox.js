// 用快速沙箱密钥重建 .env + build.sh + 签名验证
const fs = require('fs');
const path = require('path');

const sandboxData = JSON.parse(
  fs.readFileSync('d:\\trae\\temp_20261112_01\\sandbox-config.json', 'utf8')
);

const app = sandboxData.appIds[0];
const buyer = sandboxData.sandboxAccounts.user;

const sandbox = {
  appId: app.appId,
  privateKey: app.appPrivatePkcsKey,
  alipayPublicKey: app.alipayPublicKey,
  appPublicKey: app.appPublicKey,
  gateway: 'https://openapi-sandbox.dl.alipaydev.com/gateway.do',
};

console.log('✅ 快速沙箱密钥提取完成');
console.log('   appId:', sandbox.appId);
console.log('   买家账号:', buyer.email);
console.log('   买家登录密码:', buyer.logonPassword);
console.log('   买家支付密码:', buyer.payPassword);

// 验证签名
const { AlipaySdk } = require('alipay-sdk');
const sdk = new AlipaySdk({
  appId: sandbox.appId,
  privateKey: sandbox.privateKey,
  alipayPublicKey: sandbox.alipayPublicKey,
  gateway: sandbox.gateway,
  signType: 'RSA2',
  keyType: 'PKCS1'
});

const outTradeNo = 'fqtest' + Date.now();
const html = sdk.pageExec('alipay.trade.page.pay', 'POST', {
  bizContent: {
    out_trade_no: outTradeNo,
    total_amount: '0.01',
    subject: '期末刷题站·冲刺报告（快速沙箱测试）',
    product_code: 'FAST_INSTANT_TRADE_PAY'
  }
});

console.log('✅ SDK pageExec 签名成功');
console.log('   out_trade_no:', outTradeNo);
console.log('   HTML 长度:', html.length);

// 写项目根 dist/.env
const projectDir = process.cwd();
const envLines = [
  'PORT=8000',
  'UPSTASH_REDIS_REST_URL=https://handy-doe-198518.upstash.io',
  'UPSTASH_REDIS_REST_TOKEN=AzYI1YzEjqj3V5od3sKfXkYxMQt2aUq5T8NkYxMQt2aUq',
  `ALIPAY_APP_ID=${sandbox.appId}`,
  `ALIPAY_PRIVATE_KEY=${sandbox.privateKey}`,
  `ALIPAY_PUBLIC_KEY=${sandbox.appPublicKey}`,
  `ALIPAY_ALIPAY_PUBLIC_KEY=${sandbox.alipayPublicKey}`,
  `ALIPAY_GATEWAY=${sandbox.gateway}`,
  'ALIPAY_SIGN_TYPE=RSA2',
  'ALIPAY_KEY_TYPE=PKCS1',
  'ALIPAY_ENVIRONMENT=sandbox',
].join('\n');
const envPath = path.join(projectDir, 'dist', '.env');
fs.writeFileSync(envPath, envLines, 'utf8');
console.log('✅ 项目根 dist/.env 已更新');

// 更新 build.sh（在 source dir 里）
const sourceDir = 'C:\\Users\\10276\\AppData\\Local\\Temp\\trae-deploy-b3bf9e6cc70c485b8cc588f3ab3f9df9';
const buildSh = `#!/bin/sh
set -eu
export NPM_CONFIG_REGISTRY='https://registry.npmjs.org/'
npm ci --registry='https://registry.npmjs.org/'
npm prune --omit=dev
mkdir -p dist
cp server.js dist/
cp pay.js dist/ 2>/dev/null || true
cp pay-alipay.js dist/ 2>/dev/null || true
cp store-remote.js dist/ 2>/dev/null || true
cp mailer.js dist/ 2>/dev/null || true
cp run.sh dist/
cp index.html dist/ 2>/dev/null || true
cp app.js dist/ 2>/dev/null || true
cp styles.css dist/ 2>/dev/null || true
cp -R assets dist/assets 2>/dev/null || true
cp *.json dist/ 2>/dev/null || true
cp *.png dist/ 2>/dev/null || true
cp -R lib dist/lib 2>/dev/null || true
cp -R data dist/data 2>/dev/null || true
cp -R vendor dist/vendor 2>/dev/null || true
cp -R node_modules dist/node_modules
cat > dist/.env << 'ALIPAY_ENV_EOF'
PORT=8000
UPSTASH_REDIS_REST_URL=https://handy-doe-198518.upstash.io
UPSTASH_REDIS_REST_TOKEN=AzYI1YzEjqj3V5od3sKfXkYxMQt2aUq5T8NkYxMQt2aUq
ALIPAY_APP_ID=${sandbox.appId}
ALIPAY_PRIVATE_KEY=${sandbox.privateKey}
ALIPAY_PUBLIC_KEY=${sandbox.appPublicKey}
ALIPAY_ALIPAY_PUBLIC_KEY=${sandbox.alipayPublicKey}
ALIPAY_GATEWAY=${sandbox.gateway}
ALIPAY_SIGN_TYPE=RSA2
ALIPAY_KEY_TYPE=PKCS1
ALIPAY_ENVIRONMENT=sandbox
ALIPAY_ENV_EOF
chmod 755 dist/run.sh dist/server.js 2>/dev/null || true
echo "✅ build.sh 完成"
`;
fs.writeFileSync(path.join(sourceDir, 'build.sh'), buildSh, 'utf8');
console.log('✅ source dir build.sh 已更新');
console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('📱 沙箱买家（付款用）：');
console.log('   账号:', buyer.email);
console.log('   登录密码:', buyer.logonPassword);
console.log('   支付密码:', buyer.payPassword);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

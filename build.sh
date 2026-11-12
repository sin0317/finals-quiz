#!/bin/sh
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
UPSTASH_REDIS_REST_TOKEN=gQAAAAAAAwd2AAIgcDFiNGFhODMzYTBkMTk0YmNlYWEwNjI1YjBmYzI1ZWNjZg
ALIPAY_APP_ID=9021000171667707
ALIPAY_PRIVATE_KEY=MIIEpAIBAAKCAQEAkpkGTm+JoZzlcHAo/ONAFrixhynuudPFOe84GBROV/6cLzgxtffHRed0mwZXMtHzAnuRULRmk1lFRmDJpkW+w+qA/nP+3GlQIJCUfX2WESurHCSy+LqAP5QjNCL7CjjaffP2rMUxosz9Fa/k3f/DN99bts3tImFLkXbH3kPL9EF2fLfmLoh8EqqhIYl9TcgRqf6pWHLikUhndbCclgDpvYNoeq6ZRLAh3S0rW8Dj3OkVTFJD6r3xTqUd+PPTbgX7oRIIfbGltJNaNK5EF5LxO0v1dybY3wjCRQvFKnsWh9mSUowR70fZ14zk2gFfPAqCh6Vh9Lm/DPSWLtU1dBeiVQIDAQABAoIBAEd6q7OE+RO/H7RyS9n6qF4r0gv4qzkag/kapjw/cm+/asIvYTW7ygNQtu976PqTmizkuVcjjzxbc8a8HLahHUIDzr/DKUqpYvNt66lAmfJnW3hOgKF8tlnJzlx2jfdO/2IYmXdmcyxRTTnM2QhR1AsjMmHxCKYR0Lnts8ixP/opT18WBFJUoz7uoIt15CXW385OZK3oj1EV/nFDj0G/XtNDmp5yXkye2ld0eufWQmb9HB0QUefPXLc0oTj327cAtPnpWW1RXLmda862wDLwngsYqUpPw0Au4GDJ4N7yTgTkXxoa7vjZl/Zv3LWDN9/f2LpB47kszJS6zJ/fRPcYSsECgYEA1YzQO222qRqhBXo/KpAan7S1NzuK/WqANRDtlZN8rsp14a8LaM7whfI0p7qe22jmXHZNnudI6eOkwfW1QDVxjKhyKD3PUBbGToD/wPl5DOc/+MJAoLZIfS59yz9Ms4VBbrsq74UUD2gdCqBT3DswEFpkp3EgiQie8cgSmxv5kYUCgYEAr70gXhMYfKKK1XxxTRhbW0bdMIvaGRE8u4U3J46g5/CKuDNV28wHUXVsQhAMLzOgxHeLuxVgTsD1ow1CA7NG6Jv6yPzMqeMY5JsXND/IL2Vq6NbDMpd/biHrp5q05WyIOow8SDCQkhubwtJG5nyKne734+pvVovj3xIO0snmPpECgYB8a9bHSV0rmcBHmLpE6kEY3AjZbW/Fxs98G6jRhWUX0g5st7hGEIxC/qN/NlRoMe5F4QfIlaj93QyZlbdM+dZ2xY39tEWdvCc+hhp9LN1Cj1nObh+Jg6sohHX2faMK1ZESGysg8sCFWXvSPSefIT0XyhLrHBaAwO0aoh91EA+QoQKBgQCbR135IaBKSAiqF7m46COYpCW+xmOgMJXcDxorzp+oMOcxWNKtUjrJJBrSyIErl8+eqQ6C8KFXFLI2Lvm8cUTfNStDOfPQzINrQwoetZi5IEB1mYWCB1CmTDx/rHfYG6zHJrABDUBAiTp4yvmwoCyO3d6UuMlFzHc83CTS5WiWsQKBgQC9BaTL+QRuYAasT7OWD3hXGLMvs1FdDy0b+LndErZ8OnkRbNYZCye3jFf1XxVXFTBtpHjk2TXg57jMsZVQenGYK+OFM9efWFQbGMUF5G5PI2t4Nh7ZKe+ATuOUNTjTnH80D9b72UTIwROdmyVju92KbsWR2soFV47wy310dnfVUg==
ALIPAY_PUBLIC_KEY=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA1Obd4I5frxpKmGI7Jlv0/HeLjjxkDT8NEcvdPjcvwVRzzk/E+77xMis7BmQLE8oNjVUl3j9KnBoKEJnY20W80ScjUptKJK+1AoQz+Kx5fB7A30E4nR9Hce1chzozU1EZ7DxvV9x1jQLBF+FxJ+UiUjWp2dJRGqFkplkDGUURGtT3jzxPlMBZ5wpwdUEiky4TnhdXBEWEZ5vwaYuD+tzuPUotX7QVEataoCEd9Umt59jEH4C7xa2DwjCzk4jcMk++8iI7IopaU6CexbC/2QWCI9eqfuZ/p2Z3wuGfvaz4vkOVJPEOCKB8qqew9kDoPHGNfAjR+r7m4nGoRbONfIqbCQIDAQAB
ALIPAY_GATEWAY=https://openapi-sandbox.dl.alipaydev.com/gateway.do
ALIPAY_NOTIFY_URL=https://37ja0tmgyqoz551qm42.traesite.cn/api/pay/alipay-notify
ALIPAY_RETURN_URL=https://37ja0tmgyqoz551qm42.traesite.cn/api/pay/alipay-return
ALIPAY_SIGN_TYPE=RSA2
ALIPAY_KEY_TYPE=PKCS1
ALIPAY_ENVIRONMENT=sandbox
ALIPAY_ENV_EOF
chmod 755 dist/run.sh dist/server.js 2>/dev/null || true
echo "✅ build.sh 完成"

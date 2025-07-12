// server.js
const fs = require('fs');
const path = require('path');
const Proxy = require('http-mitm-proxy');
const { URL } = require('url');

const proxy = Proxy();

// 1) Carga y parsea hosts.json
const hostsFile = path.resolve(__dirname, 'hosts.json');
let mappings;
try {
    const raw = fs.readFileSync(hostsFile, 'utf8');
    mappings = JSON.parse(raw).map(entry => {
        return {
            origin: entry.host,
            filePath: path.resolve(__dirname, 'html', entry.file)
        };
    });
} catch (err) {
    console.error('❌ Error cargando hosts.json:', err);
    process.exit(1);
}

proxy.onError((ctx, err, errorKind) => {
    const url = ctx?.clientToProxyRequest?.url || '';
    console.error(`${errorKind} en ${url}:`, err);
});

proxy.onRequest((ctx, callback) => {
    const hostHeader = ctx.clientToProxyRequest.headers.host || '';
    const reqPath = ctx.clientToProxyRequest.url;
    const protocol = ctx.isSSL ? 'https:' : 'http:';

    let fullUrl;
    try {
        fullUrl = new URL(reqPath, `${protocol}//${hostHeader}`);
    } catch {
        return callback();
    }
    const FULL_URL = fullUrl.href.replace(/\/$/, "");

    // Busca si coincide con algún origin
    const hit = mappings.find(m => FULL_URL === m.origin);
    if (hit) {
        console.log('[APLICANDO PROXY]', FULL_URL, '[ARCHIVO]', hit.filePath);

        // Lee el HTML **en cada petición** para reflejar cambios
        fs.readFile(hit.filePath, (err, data) => {
            if (err) {
                console.error(`❌ Error leyendo ${hit.filePath}:`, err);
                return callback();
            }
            ctx.proxyToClientResponse.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8',
                'Content-Length': data.length
            });
            ctx.proxyToClientResponse.end(data);
        });
        return;
    }

    // Proxy normal si no hay mapping
    return callback();
});

proxy.onResponse((ctx, callback) => callback());

proxy.listen({ port: 8080 }, () => {
    console.log('🔒 Proxy HTTP/S escuchando en el puerto 8080');
});

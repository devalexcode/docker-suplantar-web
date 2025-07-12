// server.js
const fs = require('fs');
const path = require('path');
const Proxy = require('http-mitm-proxy');
const { URL } = require('url');

const proxy = Proxy();

// 2) Carga y parsea hosts.json
const hostsFile = path.resolve(__dirname, 'hosts.json');
let mappings;
try {
    const raw = fs.readFileSync(hostsFile, 'utf8');
    mappings = JSON.parse(raw).map(entry => {
        const origin = new URL(entry.host).origin;
        const filePath = path.resolve(__dirname, 'html', entry.file);
        return { origin, filePath };
    });
} catch (err) {
    console.error('❌ Error cargando hosts.json:', err);
    process.exit(1);
}

// 3) Pre-carga todos los HTML en memoria
const htmlCache = {};
for (const { origin, filePath } of mappings) {
    try {
        htmlCache[origin] = fs.readFileSync(filePath);
    } catch (err) {
        console.error(`❌ No pude leer ${filePath} para ${origin}:`, err);
        process.exit(1);
    }
}

proxy.onError((ctx, err, errorKind) => {
    const url = ctx?.clientToProxyRequest?.url || '';
    console.error(`${errorKind} en ${url}:`, err);
});

proxy.onRequest((ctx, callback) => {
    const hostHeader = ctx.clientToProxyRequest.headers.host || '';
    const reqPath = ctx.clientToProxyRequest.url;
    const protocol = ctx.isSSL ? 'https:' : 'http:';

    // Construye y normaliza la URL completa
    let fullUrl;
    try {
        fullUrl = new URL(reqPath, `${protocol}//${hostHeader}`);
    } catch (e) {
        console.log('[REQUEST] (parse error)', protocol, hostHeader, reqPath);
        return callback();
    }

    console.log('[REQUEST]', fullUrl.href);

    // Si coincide el origin, responde con el HTML cacheado
    const hit = mappings.find(m => fullUrl.origin === m.origin);
    if (hit) {

        const FULL_URL = fullUrl.href.replace(/\/$/, "");

        if (FULL_URL === hit.origin) {
            const data = htmlCache[hit.origin];
            ctx.proxyToClientResponse.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8',
                'Content-Length': data.length
            });
            ctx.proxyToClientResponse.end(data);
            return; // omitimos callback() para no reenviar upstream
        }
    }

    // Si no coincide, proxy normal
    return callback();
});

proxy.onResponse((ctx, callback) => callback());

// 4) Arranca escuchando en el puerto dinámico
proxy.listen({ port: 8080 }, () => {
    console.log(`🔒 Proxy HTTP/S escuchando en el puerto 8080`);
});

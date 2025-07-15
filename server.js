// server.js
const fs = require('fs');
const path = require('path');
const Proxy = require('http-mitm-proxy');
const { URL } = require('url');

// 1) Inicializa el proxy guardando la CA en ./certs
const proxy = Proxy({
    sslCaDir: path.resolve(__dirname, 'certs')
});

// 2) Carga y parsea hosts.json
const hostsFile = path.resolve(__dirname, 'hosts.json');
let mappings;
try {
    const raw = fs.readFileSync(hostsFile, 'utf8');
    mappings = JSON.parse(raw).map(entry => ({
        origin: entry.host.replace(/\/$/, ''),        // Sin barra final
        filePath: path.resolve(__dirname, 'html', entry.file)
    }));
} catch (err) {
    console.error('❌ Error cargando hosts.json:', err);
    process.exit(1);
}

// 3) Maneja errores globales, ignorando EPIPE
proxy.onError((ctx, err, errorKind) => {
    if (err.code === 'EPIPE') {
        console.debug('Cliente cerró conexión antes de terminar la respuesta');
        return;
    }
    const url = ctx?.clientToProxyRequest?.url || '';
    console.error(`${errorKind} en ${url}:`, err);
});

// 4) Asegura que el túnel HTTPS se establezca correctamente
proxy.onConnect((req, clientSocket, head, callback) => {
    return callback();
});

// 5) Intercepta peticiones HTTP/HTTPS
proxy.onRequest((ctx, callback) => {
    // Desactiva timeouts en la request y la response
    ctx.clientToProxyRequest.setTimeout(0);
    ctx.proxyToClientResponse.setTimeout(0);

    const hostHeader = ctx.clientToProxyRequest.headers.host;
    if (!hostHeader) {
        // Parte del túnel CONNECT: no interferimos
        return callback();
    }

    const reqPath = ctx.clientToProxyRequest.url;
    const protocol = ctx.isSSL ? 'https:' : 'http:';
    let fullUrl;

    try {
        fullUrl = new URL(reqPath, `${protocol}//${hostHeader}`)
            .href
            .replace(/\/$/, '');
    } catch {
        return callback();
    }

    const hit = mappings.find(m => m.origin === fullUrl);
    if (!hit) {
        // Sin mapping: proxy normal
        return callback();
    }

    console.log('[APLICANDO PROXY]', fullUrl, '[ARCHIVO]', hit.filePath);

    // Stream & pipe para evitar errores de timing
    const stream = fs.createReadStream(hit.filePath);
    stream.on('error', err => {
        console.error(`❌ Error leyendo ${hit.filePath}:`, err);
        return callback();
    });

    // Evitar crash por EPIPE al escribir
    ctx.proxyToClientResponse.on('error', err => {
        if (err.code === 'EPIPE') {
            console.debug('Cliente cortó conexión antes de que terminase el pipe');
        } else {
            console.error('Error enviando respuesta al cliente:', err);
        }
    });

    // Comprobar que el socket siga abierto
    if (!ctx.proxyToClientResponse.writable) {
        console.warn('Socket ya no writable, abortando envío de respuesta');
        return callback();
    }

    ctx.proxyToClientResponse.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8'
        // chunked encoding se maneja con pipe, no hace falta Content-Length
    });
    stream.pipe(ctx.proxyToClientResponse);
});

// justo antes de arrancar el proxy:
const PROXY_PORT = parseInt(process.env.PROXY_PORT, 10) || 8080;

// 6) Inicia el servidor proxy en el puerto 8080
proxy.listen({ port: 8080 }, () => {
    console.log('🔒 Proxy HTTP/S escuchando en el puerto ' + PROXY_PORT);
});

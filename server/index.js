/**
 * Effect Workspace Server
 * Minimal server - just static file serving
 */

import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';

// =========================================================================
// Security Middleware
// =========================================================================

/**
 * Content Security Policy
 */
function cspMiddleware(req, res, next) {
    const csp = [
        "default-src 'self'",
        "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://cdnjs.cloudflare.com https://shaders.noisedeck.app https://handfish.noisefactor.io https://sharing.noisedeck.app",
        "style-src 'self' 'unsafe-inline' https://handfish.noisefactor.io",
        "img-src 'self' data: blob:",
        "font-src 'self' data: https://fonts.noisefactor.io",
        "connect-src 'self' http://localhost:* https://fonts.noisefactor.io https://shaders.noisedeck.app https://sharing.noisedeck.app",
        "worker-src 'self' blob:"
    ];

    res.setHeader('Content-Security-Policy', csp.join('; '));
    next();
}

/**
 * Additional security headers
 */
function securityHeadersMiddleware(req, res, next) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
}

// =========================================================================
// Middleware Stack
// =========================================================================

app.use(cspMiddleware);
app.use(securityHeadersMiddleware);

// Static files from public directory
app.use(express.static(join(__dirname, '../public'), {
    maxAge: '1h',
    etag: true
}));

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'effect-workspace' });
});

// =========================================================================
// Start Server
// =========================================================================

app.listen(PORT, HOST, () => {
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   Foundry                                                 ║
║   Hot-reload Effects Editor                               ║
║   http://${HOST}:${PORT}                                      ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
    `);
});

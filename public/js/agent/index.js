/**
 * Foundry Agent API: a JSON command surface on window.FoundryAgent for
 * software agents that control Foundry from a browser, and from the person's
 * online session through Seance (relay.js). The contract's source is
 * public/llms.txt; it is served with the command reference at /llms-full.txt.
 *
 * @module agent
 */

import { API_VERSION, makeFailure, registerCommand, runCommand } from './dispatcher.js'
import { SCHEMAS } from './schemas.js'
import * as commands from './commands.js'
import { catalog, registerWebMCP, REMOTE } from './transports.js'
import { createAgentRelay } from './relay.js'

let _readyResolve
export const FoundryAgent = {
    version: API_VERSION,
    ready: new Promise((resolve) => { _readyResolve = resolve }),
}

if (typeof window !== 'undefined') {
    window.FoundryAgent = FoundryAgent
}

/**
 * Register every command. Call once, after the renderer and the workspace
 * exist. `ready` resolves later, from markAgentReady().
 *
 * @param {object} ctx - App references and actions; see js/app.js.
 */
export function bootstrapAgent(ctx) {
    Object.defineProperty(FoundryAgent, '_ctx', { value: ctx, enumerable: false })
    for (const name of Object.keys(SCHEMAS)) {
        registerCommand(FoundryAgent, name, commands[name])
    }
    registerWebMCP(FoundryAgent)
}

/**
 * Resolve `ready` once startup has finished, so an agent's first command
 * does not race the startup compile.
 */
export function markAgentReady() {
    _readyResolve()
}

/**
 * The Seance relay for this tab (see relay.js): its WebSocket class goes to the
 * Seance SDK, sessionCreated marks a session this tab took online, and onAgent
 * hears the first request from each agent. Through it this tab answers agent
 * commands that arrive in the person's session.
 *
 * @param {{appVersion: string, uploadImage: (blob: Blob) => Promise<string>, onAgent?: Function, BaseSocket?: typeof WebSocket}} options
 * @returns {{ WebSocket: typeof WebSocket, sessionCreated: (sessionId: string) => void }}
 */
export function createSeanceAgentRelay({ appVersion, uploadImage, onAgent, BaseSocket }) {
    return createAgentRelay({
        app: 'foundry',
        appVersion,
        catalog,
        uploadImage,
        onAgent,
        ...(BaseSocket ? { BaseSocket } : {}),
        async invoke(command, args) {
            if (SCHEMAS[command] && !REMOTE.has(command)) {
                return {
                    envelope: makeFailure(command, 'REMOTE_UNAVAILABLE',
                        `${command} needs the person at the browser and is not available through a session.`),
                }
            }
            await FoundryAgent.ready
            return runCommand(command, args, { remote: true })
        },
    })
}

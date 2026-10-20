/**
 * What each FoundryAgent command does and returns, in the groups and order
 * that public/llms-full.txt lists them. scripts/build-llms-full.mjs renders
 * the command reference from this file and SCHEMAS, and
 * test/agent-llms.test.js fails when they disagree.
 *
 * @module agent/descriptions
 */

const COMPILES = 'Foundry compiles the program the way Cmd+Enter does; it does not enforce Noisemaker\'s conventions.'

export const COMMAND_GROUPS = [
    {
        title: 'Read state',
        commands: {
            getState: {
                does: 'Returns the state snapshot. Every envelope already includes it in `state`.',
                returns: 'the snapshot',
            },
            getProgram: {
                does: 'Returns the program text (the workspace\'s dsl.txt), whether it is the program that runs, and the workspace\'s custom effect as a Portable effect, or null when the workspace has none. Through a Seance session both are what the session holds: its `main` and `effect` documents.',
                returns: '`{ dsl, running, effect }`, where `effect` is `{ name, func, namespace, description, tags, globals, passes, ..., shaders: { <program>: { glsl, wgsl } }, help }` or null',
            },
        },
    },
    {
        title: 'Programs',
        commands: {
            validateProgram: {
                does: 'Compiles `dsl` without applying it. With `effect`, the program is checked against that custom effect instead of the workspace\'s. Diagnostics come from the Noisemaker compiler; warnings do not stop a program.',
                returns: '`{ valid, diagnostics }`',
            },
            setProgram: {
                does: `Runs \`dsl\` in place of the current program and waits for its compile. With \`effect\` (a Portable effect, as getProgram returns it), that custom effect replaces the workspace's definition.json, shaders and help.md first, under the \`user\` namespace. A program with an error diagnostic changes nothing and fails with INVALID_PROGRAM; a program the renderer rejects restores the previous program and effect and fails with COMPILE_FAILED. ${COMPILES}`,
                returns: '`{ applied: true, diagnostics }`; `warnings` lists any `image:<id>` the tab does not have',
            },
            undo: {
                does: 'Undoes the last change to the program or the workspace, like the undo button.',
                returns: '`{ applied }`, false when there is nothing to undo',
            },
            redo: {
                does: 'Redoes the last undone change, like the redo button.',
                returns: '`{ applied }`, false when there is nothing to redo',
            },
        },
    },
    {
        title: 'Workspace files',
        commands: {
            listFiles: {
                does: 'Lists the workspace: its name, its files (definition.json, glsl/<program>.glsl, wgsl/<program>.wgsl, help.md, dsl.txt and any file made with "new file...") and its images. Through a Seance session it lists only the files of the session\'s program and custom effect, and no images.',
                returns: '`{ name, files: [{ path, chars }], images: [{ id, mimeType }] }`',
            },
            readFile: {
                does: 'Returns one workspace file. `dsl.txt` is the program. Through a Seance session only the files that getProgram returns can be read.',
                returns: '`{ path, content }`',
            },
            writeFile: {
                does: `Writes one workspace file as the code editor does: the custom effect is registered again from definition.json and its shaders, and the program compiles. A file that does not compile stays written, as in the editor; \`compiled\` reports the error. Write the program itself with setProgram. ${COMPILES}`,
                returns: '`{ path, chars, created, compiled: { success, error? } }`',
            },
            newEffect: {
                does: 'Starts a new custom effect named `name` from synth/solid, like file > new effect.... The workspace is replaced. Not through a session, where it would replace the person\'s whole workspace: its other files, its images and its undo history.',
                returns: '`{ name, files, dsl, compiled }`',
                remote: false,
            },
            loadEffect: {
                does: 'Copies a library effect into the workspace as a custom effect under the `user` namespace, like file > import effect from library...: its definition, GLSL and WGSL shaders and help become workspace files, and a program that uses it runs. `name` renames the copy. The workspace is replaced. Not through a session, where it would replace the person\'s whole workspace: its other files, its images and its undo history.',
                returns: '`{ loaded: true, effectId, name, files, dsl, running }`',
                remote: false,
            },
        },
    },
    {
        title: 'Saved effects',
        commands: {
            listSavedEffects: {
                does: 'Lists the person\'s saved effect workspaces, newest first.',
                returns: '`{ total, effects: [{ id, name, savedAt }] }`',
                remote: false,
            },
            loadSavedEffect: {
                does: 'Opens one of the person\'s saved effect workspaces in place of the current one, like the saved effects panel.',
                returns: '`{ loaded: true, id, name, dsl, compiled }`',
                remote: false,
            },
            saveEffect: {
                does: 'Saves the workspace and its images to the person\'s saved effects under `name`, like file > save effect workspace.... Every save is a new entry.',
                returns: '`{ saved: true, id, name }`',
                remote: false,
            },
            deleteSavedEffect: {
                does: 'Deletes one of the person\'s saved effect workspaces.',
                returns: '`{ deleted: true, id, name }`',
                remote: false,
            },
        },
    },
    {
        title: 'Effects',
        commands: {
            searchEffects: {
                does: 'Lists effects whose id, description or tags contain `query`: the library, and the workspace\'s custom effect as `user/<func>`. `namespace` keeps one namespace.',
                returns: '`{ total, effects: [{ effectId, namespace, name, description, tags }] }`',
            },
            getEffectDefinition: {
                does: 'Returns the DSL function name and the parameters of one effect, including the workspace\'s `user/<func>`.',
                returns: '`{ effectId, func, namespace, description, params: [{ name, type, default, min?, max?, enum?, choices?, uniform?, label? }] }`',
            },
        },
    },
    {
        title: 'Playback',
        commands: {
            play: { does: 'Starts the animation, like the play button.', returns: '`{ playing }`' },
            pause: { does: 'Stops the animation. The current frame stays visible.', returns: '`{ playing }`' },
            setBackend: {
                does: 'Renders with WebGL2 (the GLSL shaders) or WebGPU (the WGSL shaders), as opening a .glsl or .wgsl file in the editor does. Fails with BACKEND_UNAVAILABLE when the browser cannot.',
                returns: '`{ backend }`',
                remote: false,
            },
        },
    },
    {
        title: 'Images and files',
        commands: {
            getThumbnail: {
                does: 'Returns an image of the canvas as the person sees it; it renders no extra frame. Through a Seance session the image is added to the session as its own bytes, and `image` replaces `bytes`.',
                returns: '`{ bytes, mimeType, width, height }`, with `bytes` in base64. Through a session: `{ image: { id, mimeType, bytes }, mimeType, width, height }`, where `image.bytes` is the byte count',
            },
            exportZip: {
                does: 'Starts a browser download of the workspace as a ZIP, like file > export effect to zip.',
                returns: '`{ started: true, name }`',
                remote: false,
            },
        },
    },
    {
        title: 'Other apps',
        commands: {
            importComposition: {
                does: 'Loads a composition from a Noise Factor sharing link (https://sharing.noisedeck.app/s/CODE, an app link ending in ?code=CODE, or the code), like effect > import from url...: its program, its first custom effect (as the workspace\'s effect) and its images.',
                returns: '`{ title, effects, images, dsl, compiled }`, where `effects` lists the custom effect names and `images` counts the images',
                remote: false,
            },
        },
    },
]

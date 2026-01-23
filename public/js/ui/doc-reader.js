/**
 * Documentation Reader Panel
 * 
 * Renders markdown documentation in a side panel.
 * @module ui/doc-reader
 */

let docReaderPanel = null
let docReaderContent = null

/**
 * Initialize the doc reader panel references
 */
export function initDocReader() {
    docReaderPanel = document.getElementById('doc-reader-panel')
    docReaderContent = document.getElementById('doc-reader-content')
    
    // Set up click handlers for internal links
    if (docReaderContent) {
        docReaderContent.addEventListener('click', handleDocClick)
    }
}

/**
 * Handle clicks within the doc reader content
 */
function handleDocClick(e) {
    const link = e.target.closest('a')
    if (!link) return
    
    const href = link.getAttribute('href')
    if (!href) return
    
    // Handle back links
    if (href === '#back') {
        e.preventDefault()
        showPlaceholderContent()
        return
    }
    
    // Allow external links to open normally
}

/**
 * Show the documentation reader panel
 */
export function showDocReader() {
    if (!docReaderPanel) return
    docReaderPanel.classList.add('visible')
}

/**
 * Hide the documentation reader panel
 */
export function hideDocReader() {
    if (!docReaderPanel) return
    docReaderPanel.classList.remove('visible')
}

/**
 * Toggle the documentation reader panel visibility
 * @returns {boolean} Whether the panel is now visible
 */
export function toggleDocReader() {
    if (!docReaderPanel) return false
    docReaderPanel.classList.toggle('visible')
    return docReaderPanel.classList.contains('visible')
}

/**
 * Check if the doc reader is currently visible
 * @returns {boolean}
 */
export function isDocReaderVisible() {
    return docReaderPanel?.classList.contains('visible') ?? false
}

/**
 * Render markdown content in the doc reader
 * @param {string} markdown - The markdown content to render
 */
export function renderDocContent(markdown) {
    if (!docReaderContent) return
    
    // Use the globally loaded marked library
    if (typeof marked !== 'undefined') {
        docReaderContent.innerHTML = marked.parse(markdown)
        
        // Add build info at the end
        const addBuildInfo = (hash = 'LOCAL', dateStr = 'n/a') => {
            // Remove any existing build info first
            const existing = docReaderContent.querySelector('.doc-build-info')
            if (existing) existing.remove()
            
            const buildInfo = document.createElement('div')
            buildInfo.className = 'doc-build-info'
            buildInfo.style.cssText = 'font-family: ui-monospace, \'Cascadia Mono\', \'Consolas\', monospace; font-size: 9px; color: #444; border-top: 1px solid rgba(255, 255, 255, 0.05); padding-top: 1em; margin-top: 1em;'
            buildInfo.textContent = `build: ${hash} / deployed: ${dateStr}`
            docReaderContent.appendChild(buildInfo)
        }
        
        fetch('/deployment-meta.json')
            .then(r => r.json())
            .then(meta => {
                const hash = meta.git_hash ? meta.git_hash.trim().slice(0, 8) : 'LOCAL'
                let dateStr = 'n/a'
                
                if (meta.date) {
                    const date = new Date(meta.date * 1000)
                    const pad = (n) => String(n).padStart(2, '0')
                    dateStr = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
                }
                
                addBuildInfo(hash, dateStr)
            })
            .catch(() => addBuildInfo())
        
        // Scroll to top when content changes
        docReaderContent.scrollTop = 0
    } else {
        // Fallback: display as preformatted text
        docReaderContent.innerHTML = `<pre>${markdown}</pre>`
    }
}

/**
 * Show placeholder documentation content
 */
export function showPlaceholderContent() {
    const placeholder = `# Effect Workspace

## Documentation

Welcome to Effect Workspace, a hot-reload effects editor.

*Documentation content will be populated here.*
`
    renderDocContent(placeholder)
}

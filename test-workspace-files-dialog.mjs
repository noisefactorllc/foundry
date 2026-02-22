/**
 * Test Workspace Files Dialog
 * Debug why files don't load when selected
 */

import { chromium } from 'playwright'

async function test() {
    const browser = await chromium.launch({ headless: false })
    const page = await browser.newPage()
    
    // Collect console logs - filter out WebGL noise
    const logs = []
    page.on('console', msg => {
        const text = msg.text()
        if (!text.includes('WebGL Error') && !text.includes('1281')) {
            logs.push(`[${msg.type()}] ${text}`)
            console.log(`[CONSOLE] ${text}`)
        }
    })
    
    page.on('pageerror', err => {
        console.log(`[PAGE ERROR] ${err.message}`)
    })

    try {
        console.log('Loading Effect Workspace...')
        await page.goto('http://localhost:3000', { waitUntil: 'networkidle' })
        await page.waitForTimeout(2000)
        
        // Check if workspace has files
        const filesCount = await page.evaluate(() => {
            const ws = window.effectWorkspace
            if (!ws || !ws.workspaceStore) {
                console.log('effectWorkspace.workspaceStore not found on window')
                return -1
            }
            const files = ws.workspaceStore.listFiles()
            console.log('Workspace files:', files)
            return files.length
        })
        console.log(`Workspace has ${filesCount} files`)
        
        // Always load an effect to ensure workspace has files
        console.log('Loading an effect...')
        
        // Open effect dialog with Cmd+O
        await page.keyboard.press('Meta+o')
        await page.waitForTimeout(1000)
        
        // Check if dialog opened
        const effectDialogVisible = await page.isVisible('.open-effect-overlay')
        console.log('Effect dialog visible:', effectDialogVisible)
        
        if (effectDialogVisible) {
            // Just press Enter to select first effect in list
            console.log('Pressing Enter to select first effect...')
            await page.keyboard.press('Enter')
            await page.waitForTimeout(3000)
            
            // Verify files were added
            const newFilesCount = await page.evaluate(() => {
                const ws = window.effectWorkspace
                if (!ws || !ws.workspaceStore) return -1
                const files = ws.workspaceStore.listFiles()
                console.log('Workspace files after loading effect:', files)
                return files.length
            })
            console.log(`After loading effect, workspace has ${newFilesCount} files`)
        } else {
            console.log('ERROR: Effect dialog did not open!')
            await browser.close()
            return
        }
        
        // Now try to open workspace files dialog with Cmd+P
        console.log('Opening workspace files dialog with Cmd+P...')
        await page.keyboard.press('Meta+p')
        await page.waitForTimeout(500)
        
        // Check if dialog opened
        const dialogVisible = await page.isVisible('.workspace-files-overlay')
        console.log('Workspace files dialog visible:', dialogVisible)
        
        if (!dialogVisible) {
            console.log('ERROR: Workspace files dialog did not open!')
            
            // Check what keyboard shortcuts are registered
            const shortcuts = await page.evaluate(() => {
                // Try to find the keyboard handler
                return 'Check keyboard registration'
            })
            
            await browser.close()
            return
        }
        
        // Get list of files in dialog
        const dialogFiles = await page.evaluate(() => {
            const items = document.querySelectorAll('.workspace-files-item')
            return Array.from(items).map(item => {
                const name = item.querySelector('.workspace-files-name')
                return name ? name.textContent : 'unknown'
            })
        })
        console.log('Files in dialog:', dialogFiles)
        
        if (dialogFiles.length === 0) {
            console.log('ERROR: No files shown in dialog!')
            await browser.close()
            return
        }
        
        // Click on the first file
        console.log('Clicking first file...')
        const firstFile = await page.$('.workspace-files-item')
        
        // Before clicking, check the state of the dialog
        const dialogState = await page.evaluate(() => {
            const dialog = document.querySelector('.workspace-files-dialog')
            const overlay = document.querySelector('.workspace-files-overlay')
            
            // Check if there's a WorkspaceFilesDialog instance we can inspect
            // Look at the first item's event listeners
            const firstItem = document.querySelector('.workspace-files-item')
            
            return {
                dialogExists: !!dialog,
                overlayExists: !!overlay,
                firstItemExists: !!firstItem,
                firstItemHTML: firstItem ? firstItem.outerHTML.substring(0, 200) : 'none'
            }
        })
        console.log('Dialog state before click:', dialogState)
        
        // Listen for any errors during click
        const errorsBeforeClick = []
        const errorHandler = (err) => errorsBeforeClick.push(err.message)
        page.on('pageerror', errorHandler)
        
        // Actually click
        await firstFile.click()
        await page.waitForTimeout(1000)
        
        console.log('Errors during click:', errorsBeforeClick)
        page.off('pageerror', errorHandler)
        
        // Check if dialog closed
        const dialogStillVisible = await page.isVisible('.workspace-files-overlay')
        console.log('Dialog still visible after click:', dialogStillVisible)
        
        // Check if file was loaded into editor
        const editorContent = await page.evaluate(() => {
            const editor = document.getElementById('canvas-editor')
            if (!editor) return 'editor not found'
            return editor.value ? editor.value.substring(0, 100) : 'empty'
        })
        console.log('Editor content after click:', editorContent)
        
        // Check menu filename
        const menuFilename = await page.evaluate(() => {
            const el = document.getElementById('menuFilename')
            return el ? el.textContent : 'not found'
        })
        console.log('Menu filename:', menuFilename)
        
        // Print all console logs
        console.log('\n=== All console logs ===')
        logs.forEach(log => console.log(log))
        
        await page.waitForTimeout(2000)
        
    } catch (err) {
        console.error('Test error:', err)
    } finally {
        await browser.close()
    }
}

test()

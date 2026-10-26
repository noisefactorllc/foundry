/**
 * Test Workspace Files Dialog - Debug version
 */

import { chromium } from 'playwright'

async function test() {
    const browser = await chromium.launch({ headless: true })
    const page = await browser.newPage()
    
    // Collect console logs
    const logs = []
    page.on('console', msg => {
        logs.push(`[${msg.type()}] ${msg.text()}`)
    })
    
    page.on('pageerror', err => {
        console.log(`[PAGE ERROR] ${err.message}`)
    })

    try {
        console.log('1. Loading Effect Workspace...')
        await page.goto('http://localhost:3000', { waitUntil: 'networkidle' })
        await page.waitForTimeout(3000)
        
        // Wait for app to be ready
        await page.waitForSelector('#app.loaded', { timeout: 10000 })
        console.log('   App loaded')
        
        // 2. Open effect dialog and load an effect
        console.log('2. Opening effect dialog...')
        await page.keyboard.press('Meta+o')
        await page.waitForTimeout(500)
        
        const effectDialogVisible = await page.isVisible('.open-effect-overlay')
        console.log(`   Effect dialog visible: ${effectDialogVisible}`)
        
        if (!effectDialogVisible) {
            console.log('FAIL: Effect dialog did not open')
            await browser.close()
            return
        }
        
        // Wait for effect list to populate
        await page.waitForSelector('.open-effect-item', { timeout: 5000 })
        const effectCount = await page.$$eval('.open-effect-item', items => items.length)
        console.log(`   Found ${effectCount} effects in list`)
        
        // Select first effect
        await page.keyboard.press('Enter')
        await page.waitForTimeout(2000)
        
        // Check if workspace has files now
        const filesInWorkspace = await page.evaluate(() => {
            const ws = window.effectWorkspace
            if (!ws || !ws.workspaceStore) return []
            return ws.workspaceStore.listFiles()
        })
        console.log(`   Workspace files: ${JSON.stringify(filesInWorkspace)}`)
        
        if (filesInWorkspace.length === 0) {
            console.log('FAIL: No files in workspace after loading effect')
            await browser.close()
            return
        }
        
        // 3. Open workspace files dialog
        console.log('3. Opening workspace files dialog with Cmd+P...')
        await page.keyboard.press('Meta+p')
        await page.waitForTimeout(500)
        
        const wfDialogVisible = await page.isVisible('.workspace-files-overlay')
        console.log(`   Workspace files dialog visible: ${wfDialogVisible}`)
        
        if (!wfDialogVisible) {
            console.log('FAIL: Workspace files dialog did not open')
            await browser.close()
            return
        }
        
        // Get files in dialog
        const dialogFiles = await page.$$eval('.workspace-files-item', items => 
            items.map(item => item.querySelector('.workspace-files-name')?.textContent || 'unknown')
        )
        console.log(`   Files in dialog: ${JSON.stringify(dialogFiles)}`)
        
        if (dialogFiles.length === 0) {
            console.log('FAIL: No files shown in dialog')
            await browser.close()
            return
        }
        
        // 4. Click on a GLSL file (not dsl.txt)
        const glslFile = dialogFiles.find(f => f.endsWith('.glsl'))
        const targetFile = glslFile || dialogFiles.find(f => f !== 'dsl.txt') || dialogFiles[0]
        console.log(`4. Clicking on file: ${targetFile}`)
        
        // Find and click the item without hovering first
        const clickedFile = await page.evaluate((target) => {
            const items = document.querySelectorAll('.workspace-files-item')
            for (const item of items) {
                const name = item.querySelector('.workspace-files-name')?.textContent
                if (name === target) {
                    // Directly simulate click without mouse movement
                    item.click()
                    return name
                }
            }
            return null
        }, targetFile)
        console.log(`   Clicked file: ${clickedFile}`)
        await page.waitForTimeout(500)
        
        // 5. Check results
        console.log('5. Checking results...')
        
        const dialogStillVisible = await page.isVisible('.workspace-files-overlay')
        console.log(`   Dialog closed: ${!dialogStillVisible}`)
        
        const menuFilename = await page.$eval('#menuFilename', el => el.textContent)
        console.log(`   Menu filename: ${menuFilename}`)
        
        const editorContent = await page.evaluate(() => {
            const editor = document.getElementById('canvas-editor')
            if (!editor) return 'NO EDITOR'
            const val = editor.value
            return val ? val.substring(0, 100) : 'EMPTY'
        })
        console.log(`   Editor content: ${editorContent}`)
        
        // Print relevant logs
        console.log('\n=== Console logs containing WorkspaceFiles or switchEditorFile ===')
        logs.filter(l => l.includes('WorkspaceFiles') || l.includes('switchEditorFile'))
            .forEach(l => console.log(l))
        
        // Final verdict
        console.log('\n=== VERDICT ===')
        if (editorContent !== 'EMPTY' && editorContent !== 'NO EDITOR' && menuFilename === targetFile) {
            console.log('PASS: File was loaded correctly')
        } else {
            console.log('FAIL: File was NOT loaded')
            console.log('  Expected menu filename:', targetFile)
            console.log('  Actual menu filename:', menuFilename)
            console.log('  Editor content:', editorContent)
        }
        
    } catch (err) {
        console.error('Test error:', err)
    } finally {
        await browser.close()
    }
}

test()

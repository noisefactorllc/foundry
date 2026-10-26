/**
 * Simple test to verify effect loading in Effect Workspace
 */

import { chromium } from 'playwright';

async function testEffectLoading() {
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();
    
    // Capture console logs
    page.on('console', msg => {
        console.log(`[BROWSER ${msg.type().toUpperCase()}] ${msg.text()}`);
    });
    
    // Navigate to Effect Workspace
    console.log('Navigating to Effect Workspace...');
    await page.goto('http://localhost:3456', { waitUntil: 'networkidle' });
    
    // Wait for initialization
    await page.waitForTimeout(3000);
    
    // Check if there are any errors in the compile status
    const status = await page.locator('#compile-status').textContent();
    console.log('\nCompile status:', status);
    
    // Try to compile a simple DSL
    console.log('\nTrying to compile simple DSL...');
    
    // Access the renderer via window
    const result = await page.evaluate(async () => {
        const renderer = window.effectWorkspaceRenderer;
        if (!renderer) {
            return { error: 'No effectWorkspaceRenderer on window' };
        }
        
        const dsl = `search filter, synth
noise().warp().write(o0)
render(o0)`;
        
        try {
            const compileResult = await renderer.compile(dsl);
            return { success: compileResult.success, error: compileResult.error };
        } catch (e) {
            return { error: e.message };
        }
    });
    
    console.log('\nCompile result:', JSON.stringify(result, null, 2));
    
    // Keep browser open for inspection
    console.log('\nBrowser will stay open for 30 seconds for inspection...');
    await page.waitForTimeout(30000);
    
    await browser.close();
}

testEffectLoading().catch(console.error);

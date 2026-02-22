/**
 * Test for console errors when loading Effect Workspace
 * Checks for JavaScript errors, especially related to missing elements
 */

import { chromium } from 'playwright';

async function testLoading() {
    console.log('Starting Effect Workspace loading test...\n');
    
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    
    const consoleErrors = [];
    const consoleWarnings = [];
    const pageErrors = [];
    
    // Capture console messages
    page.on('console', msg => {
        const type = msg.type();
        const text = msg.text();
        
        if (type === 'error') {
            consoleErrors.push(text);
            console.log(`[ERROR] ${text}`);
        } else if (type === 'warning') {
            consoleWarnings.push(text);
            console.log(`[WARN] ${text}`);
        }
    });
    
    // Capture page errors (uncaught exceptions)
    page.on('pageerror', error => {
        pageErrors.push(error.message);
        console.log(`[PAGE ERROR] ${error.message}`);
    });
    
    try {
        // Navigate to Effect Workspace
        console.log('Navigating to http://localhost:3000...'););
        await page.goto('http://localhost:3000', { 
            waitUntil: 'networkidle',
            timeout: 30000 
        });
        
        // Wait a bit for any deferred initialization
        await page.waitForTimeout(2000);
        
        // Try to interact with the page to trigger any lazy errors
        console.log('\nChecking for missing elements...');
        
        // Check for specific elements that might be missing
        const elementsToCheck = [
            'duration-input',
            'fps-counter',
            'playback-controls',
            'control-buttons',
            'canvas'
        ];
        
        for (const id of elementsToCheck) {
            const exists = await page.evaluate((elementId) => {
                const el = document.getElementById(elementId);
                return el !== null;
            }, id);
            console.log(`  #${id}: ${exists ? '✓ found' : '✗ NOT FOUND'}`);
        }
        
        // Wait a bit more to catch any delayed errors
        await page.waitForTimeout(1000);
        
    } catch (err) {
        console.error(`\nNavigation error: ${err.message}`);
    }
    
    await browser.close();
    
    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));
    
    console.log(`\nPage Errors (uncaught exceptions): ${pageErrors.length}`);
    if (pageErrors.length > 0) {
        pageErrors.forEach((err, i) => {
            console.log(`  ${i + 1}. ${err}`);
        });
    }
    
    console.log(`\nConsole Errors: ${consoleErrors.length}`);
    if (consoleErrors.length > 0) {
        consoleErrors.forEach((err, i) => {
            console.log(`  ${i + 1}. ${err}`);
        });
    }
    
    console.log(`\nConsole Warnings: ${consoleWarnings.length}`);
    if (consoleWarnings.length > 0) {
        consoleWarnings.forEach((warn, i) => {
            console.log(`  ${i + 1}. ${warn}`);
        });
    }
    
    // Look for specific error patterns
    const allErrors = [...pageErrors, ...consoleErrors];
    const nullErrors = allErrors.filter(e => 
        e.includes('null') || 
        e.includes('undefined') ||
        e.includes('Cannot read properties')
    );
    
    if (nullErrors.length > 0) {
        console.log('\n⚠️  Errors related to null/undefined elements:');
        nullErrors.forEach((err, i) => {
            console.log(`  ${i + 1}. ${err}`);
        });
    }
    
    const exitCode = pageErrors.length + consoleErrors.length > 0 ? 1 : 0;
    console.log(`\nTest ${exitCode === 0 ? 'PASSED ✓' : 'FAILED ✗'}`);
    process.exit(exitCode);
}

testLoading().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});

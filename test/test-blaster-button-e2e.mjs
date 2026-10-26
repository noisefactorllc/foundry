/**
 * E2E test for NoiseBLASTER publish button in Foundry
 * Tests that the button is visible after sharing an effect
 */

import { chromium } from 'playwright';

async function testBlasterButton() {
    console.log('=== Testing NoiseBLASTER! Publish Button in Foundry ===\n');
    
    const browser = await chromium.launch({ 
        headless: false,
        slowMo: 100
    });
    const context = await browser.newContext({
        viewport: { width: 1280, height: 800 }
    });
    const page = await context.newPage();
    
    const errors = [];
    
    page.on('console', msg => {
        if (msg.type() === 'error') {
            errors.push(msg.text());
        }
    });
    
    page.on('pageerror', error => {
        errors.push(error.message);
    });
    
    try {
        console.log('1. Navigating to Foundry...');
        await page.goto('http://localhost:3002', { waitUntil: 'networkidle', timeout: 30000 });
        
        console.log('2. Waiting for app to load...');
        await page.waitForTimeout(3000);
        
        // Look for share button - check various possible selectors
        console.log('3. Looking for share button...');
        
        // Try different selectors for the share button
        let shareBtn = await page.$('#share-btn');
        if (!shareBtn) {
            shareBtn = await page.$('[data-action="share"]');
        }
        if (!shareBtn) {
            shareBtn = await page.$('button:has-text("Share")');
        }
        if (!shareBtn) {
            // Check menu for share option
            const menuBtn = await page.$('#menu-button, .menu-button, [aria-label="Menu"]');
            if (menuBtn) {
                console.log('   Found menu button, clicking...');
                await menuBtn.click();
                await page.waitForTimeout(500);
                shareBtn = await page.$('button:has-text("Share"), [data-action="share"]');
            }
        }
        
        if (!shareBtn) {
            console.log('   No share button found, checking for menu items...');
            // Try keyboard shortcut
            await page.keyboard.press('Control+s');
            await page.waitForTimeout(500);
        } else {
            console.log('   Found share button, clicking...');
            await shareBtn.click();
        }
        
        // Wait for share modal
        console.log('4. Waiting for share modal...');
        await page.waitForTimeout(1000);
        
        const shareModal = await page.$('.share-modal, .modal-overlay, [role="dialog"]');
        if (!shareModal) {
            console.log('   Share modal not found, taking screenshot...');
            await page.screenshot({ path: 'foundry-blaster-debug.png', fullPage: true });
            console.log('   Screenshot saved to foundry-blaster-debug.png');
            
            // Try to find share via different route
            console.log('   Trying to find share via app menu...');
            await page.keyboard.press('Escape');
            await page.waitForTimeout(300);
        }
        
        // If modal is open, click Share button
        console.log('5. Looking for Share submit button...');
        const submitBtn = await page.$('#share-submit-btn');
        if (submitBtn) {
            console.log('   Found share submit button, clicking...');
            await submitBtn.click();
            
            // Wait for share to complete
            console.log('6. Waiting for share to complete...');
            await page.waitForTimeout(5000);
        }
        
        // Check for share result (URL field populated)
        console.log('7. Checking for share result...');
        const shareUrlField = await page.$('#share-url');
        if (shareUrlField) {
            const urlValue = await shareUrlField.inputValue();
            if (urlValue && urlValue.includes('sharing.noisedeck.app')) {
                console.log(`   Share successful: ${urlValue}`);
            } else {
                console.log('   Share URL not yet populated, waiting more...');
                await page.waitForTimeout(3000);
            }
        }
        
        // Now look for the blaster button
        console.log('8. Looking for NoiseBLASTER! publish button...');
        
        const blasterBtn = await page.$('#share-blaster-btn');
        if (!blasterBtn) {
            console.log('\n=== TAKING DEBUG SCREENSHOT ===');
            await page.screenshot({ path: 'foundry-blaster-debug.png', fullPage: true });
            console.log('Screenshot saved to foundry-blaster-debug.png');
            console.error('\nFAIL: NoiseBLASTER! publish button not found');
            await browser.close();
            process.exit(1);
        }
        
        const isVisible = await blasterBtn.isVisible();
        if (!isVisible) {
            console.log('\n=== TAKING DEBUG SCREENSHOT ===');
            await page.screenshot({ path: 'foundry-blaster-debug.png', fullPage: true });
            console.error('\nFAIL: NoiseBLASTER! publish button exists but is not visible');
            await browser.close();
            process.exit(1);
        }
        
        const box = await blasterBtn.boundingBox();
        if (!box || box.width < 50 || box.height < 20) {
            console.log('\n=== TAKING DEBUG SCREENSHOT ===');
            await page.screenshot({ path: 'foundry-blaster-debug.png', fullPage: true });
            console.error('\nFAIL: NoiseBLASTER! publish button has invalid dimensions', box);
            await browser.close();
            process.exit(1);
        }
        
        console.log('\n=== SUCCESS ===');
        console.log('NoiseBLASTER! publish button is visible');
        console.log(`Button dimensions: ${box.width.toFixed(0)}x${box.height.toFixed(0)} at (${box.x.toFixed(0)}, ${box.y.toFixed(0)})`);
        
        // Check button text/content
        const buttonText = await blasterBtn.textContent();
        console.log(`Button text: "${buttonText.trim().substring(0, 30)}..."`);
        
        // Check for the NoiseBLASTER SVG logo
        const hasSvg = await blasterBtn.$('svg');
        console.log(`Has SVG logo: ${!!hasSvg}`);
        
        // Take success screenshot
        await page.screenshot({ path: 'foundry-blaster-success.png', fullPage: true });
        console.log('\nSuccess screenshot saved to foundry-blaster-success.png');
        
        if (errors.length > 0) {
            console.log('\nConsole errors during test:');
            errors.forEach(e => console.log(`  - ${e}`));
        }
        
        await browser.close();
        console.log('\n=== TEST PASSED ===');
        process.exit(0);
        
    } catch (error) {
        console.error('\n=== TEST FAILED ===');
        console.error('Error:', error.message);
        
        try {
            await page.screenshot({ path: 'foundry-blaster-error.png', fullPage: true });
            console.log('Error screenshot saved to foundry-blaster-error.png');
        } catch (e) {
            // Ignore screenshot errors
        }
        
        await browser.close();
        process.exit(1);
    }
}

testBlasterButton();

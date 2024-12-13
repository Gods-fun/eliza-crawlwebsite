import { Builder, By, until, WebDriver as SeleniumWebDriver } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome';
import { elizaLogger } from "@ai16z/eliza";
import { ActionExample, Content, HandlerCallback, IAgentRuntime, Memory, State, Action } from "@ai16z/eliza";
import path from 'path';
import { Runtime } from 'tslog';

// Get ChromeDriver path
const chromedriverPath = require('chromedriver').path;
elizaLogger.log('ChromeDriver path:', chromedriverPath);
// Add this at the top of your file with other imports
const validatedProfiles = new Map<string, boolean>();
export const seleniumProfilesAction: Action = {
    name: "EXTRACT_TWITTER_PROFILES",
    similes: ["EXTRACT_TWITTER_PROFILES", "/scrape"],
    description: "Extract Twitter profile links",
    validate: async (runtime: IAgentRuntime, message: Memory) => {
        return true;
    },
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: { [key: string]: unknown },
        callback?: HandlerCallback
    ): Promise<boolean> => {
        let driver: SeleniumWebDriver | null = null;

        try {
            const websiteUrl = runtime.getSetting("WEBSITE_URL");
            if (!websiteUrl) {
                throw new Error("WEBSITE_URL not configured in .env");
            }

            elizaLogger.log('Starting profile extraction from:', websiteUrl);

            // Set up Chrome options for WSL
            const options = new chrome.Options();

            // Set the binary path to the Chrome installed in WSL
            options.setBinaryPath('/usr/bin/google-chrome'); // Update this if you have a different path

            // Essential Chrome options for headless mode and WSL
            options.addArguments(
                '--no-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-extensions',
                '--window-size=1920,1080'
            );

            // Use X11 DISPLAY for WSL (if needed)
            const display = process.env.DISPLAY || ':0';
            if (display) {
                options.addArguments(`--display=${display}`);
            } else {
                throw new Error("DISPLAY environment variable is not set. Ensure Xming is running.");
            }

            // Create ChromeDriver service with the correct chromedriver
            const serviceBuilder = new chrome.ServiceBuilder(chromedriverPath)
                .setPort(9515)
                .enableVerboseLogging()
                .loggingTo('chromedriver.log');

            elizaLogger.log('Creating WebDriver with options:', {
                chromedriverPath,
                servicePort: 9515,
                display
            });

            // Create WebDriver instance with timeout
            driver = await new Builder()
                .forBrowser('chrome')
                .setChromeOptions(options)
                .setChromeService(serviceBuilder)
                .build();

            // Set page load timeout
            await driver.manage().setTimeouts({
                pageLoad: 30000,
                script: 30000
            });

            // Navigate to the URL
            await driver.get(websiteUrl);
            
            // Wait for document ready state with better error handling
            try {
                await driver.wait(async function() {
                    const readyState = await driver.executeScript('return document.readyState');
                    elizaLogger.log('Page ready state:', readyState);
                    return readyState === 'complete';
                }, 10000, 'Timeout waiting for page load');

                // Additional wait for any dynamic content
                await driver.wait(async function() {
                    const bodyPresent = await driver.findElements(By.tagName('body'));
                    return bodyPresent.length > 0;
                }, 5000, 'Timeout waiting for body element');

            } catch (error) {
                elizaLogger.error('Page load error:', error);
                // Continue execution even if wait times out
            }

            // Short pause for any remaining dynamic content
            await driver.sleep(2000);

            // Common selectors for clickable elements that might load new content
            const interactiveSelectors = [
                'nav a',
                '.nav-link',
                '.nav-item',
                '[role="tab"]',
                '.tab',
                'button:not([disabled])',
                '[role="button"]',
                '.btn',
                'li[onclick]',
                'li[role="button"]',
                '.clickable',
                '[data-toggle]',
                '[data-target]'
            ].join(',');

            const allProfiles: string[] = [];

            // First extract from the main page
            elizaLogger.log('Processing main page');
            const mainPageProfiles = await extractProfilesFromCurrentPage(driver);
            allProfiles.push(...mainPageProfiles);

            // Find all interactive elements
            const elements = await driver.findElements(By.css(interactiveSelectors));
            elizaLogger.log(`Found ${elements.length} interactive elements`);

            // Process each interactive element
            for (let i = 0; i < elements.length; i++) {
                try {
                    // Re-find elements to avoid stale references
                    const currentElements = await driver.findElements(By.css(interactiveSelectors));
                    if (i >= currentElements.length) continue;
                    
                    const element = currentElements[i];
                    
                    // Get element info for logging
                    const elementText = await element.getText().catch(() => '');
                    const elementTag = await element.getTagName().catch(() => '');
                    elizaLogger.log(`Processing element: ${elementTag} - ${elementText}`);

                    // Check if element is visible and clickable
                    const isDisplayed = await element.isDisplayed().catch(() => false);
                    if (!isDisplayed) continue;

                    // Store current URL to detect changes
                    const currentUrl = await driver.getCurrentUrl();

                    // Click the element
                    await element.click().catch(async (err) => {
                        elizaLogger.log(`Click failed, trying JavaScript click: ${err.message}`);
                        await driver.executeScript('arguments[0].click()', element);
                    });

                    // Wait for any potential changes
                    await Promise.race([
                        driver.wait(async () => {
                            const newUrl = await driver.getCurrentUrl();
                            return newUrl !== currentUrl;
                        }, 2000).catch(() => {}),
                        driver.wait(until.stalenessOf(element), 2000).catch(() => {}),
                        driver.sleep(2000)
                    ]);

                    // Extract profiles from the new state
                    const newProfiles = await extractProfilesFromCurrentPage(driver);
                    allProfiles.push(...newProfiles);

                    // Try to go back if URL changed
                    const newUrl = await driver.getCurrentUrl();
                    if (newUrl !== currentUrl) {
                        await driver.navigate().back();
                        await driver.sleep(1000);
                    }

                } catch (error) {
                    elizaLogger.error(`Error processing element ${i}:`, error);
                    // Try to continue with next element
                    continue;
                }
            }
            elizaLogger.log('processing elements completed');


            // Ensure unique profiles
            const uniqueProfiles = [...new Set(allProfiles)];
            // Close the driver IMMEDIATELY after getting profiles
            if (driver) {
                await driver.quit().catch(error => {
                    elizaLogger.error('Error quitting driver:', error);
                });
                driver = null;
                elizaLogger.log('Driver closed successfully');
            }
            // Update target users AFTER driver is closed
            elizaLogger.log('Updating target users...');
            const currentTargetUsers = runtime.getSetting("TWITTER_TARGET_USERS") || "";
            const currentUsers = currentTargetUsers.split(',').filter(u => u.trim());
            const updatedUsers = [...new Set([...currentUsers, ...uniqueProfiles])];

           // Update environment variable directly
            process.env.TWITTER_TARGET_USERS = updatedUsers.join(',');
            elizaLogger.log(`Updated target users: ${updatedUsers.length} total users`);
            elizaLogger.log(`env variable: ${runtime.getSetting("TWITTER_TARGET_USERS")} `);

            // Callback with results
            if (callback) {
                callback({
                    text: `Found ${uniqueProfiles.length} Twitter profiles across all sections: ${uniqueProfiles.join(', ')}`,
                    content: {
                        websiteUrl,
                        profiles: uniqueProfiles
                    }
                });
            }

            return true;

        } catch (error) {
            elizaLogger.error('Error details:', {
                message: error.message,
                stack: error.stack,
                name: error.name
            });

            // Callback with error message
            if (callback) {
                callback({
                    text: `Error extracting Twitter profiles: ${error.message}`,
                    content: { error: error.message }
                });
            }
            return false;
        } finally {
            // Quit the driver after execution
            if (driver) {
                await driver.quit().catch(console.error);
            }
        }
    },
    examples: [
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Extract Twitter profiles from the configured website"
                }
            },
            {
                user: "agent",
                content: {
                    text: "Found Twitter profiles: user1, user2, user3",
                    action: "EXTRACT_TWITTER_PROFILES",
                    content: {
                        websiteUrl: "https://example.com",
                        profiles: ["user1", "user2", "user3"]
                    }
                }
            }
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Can you scrape Twitter profiles?"
                }
            },
            {
                user: "agent",
                content: {
                    text: "Found Twitter profiles: user4, user5",
                    action: "EXTRACT_TWITTER_PROFILES",
                    content: {
                        websiteUrl: "https://anotherexample.com",
                        profiles: ["user4", "user5"]
                    }
                }
            }
        ]
    ] as ActionExample[][]
};

async function validateTwitterUsername(username: string, driver: SeleniumWebDriver): Promise<boolean> {
    // Check cache first
    if (validatedProfiles.has(username)) {
        elizaLogger.log(`Using cached result for @${username}: ${validatedProfiles.get(username)}`);
        return validatedProfiles.get(username) || false;
    }

    try {
        const mainWindow = await driver.getWindowHandle();
        await driver.executeScript('window.open()');
        const windows = await driver.getAllWindowHandles();
        await driver.switchTo().window(windows[windows.length - 1]);

        elizaLogger.log(`Validating new profile: @${username}`);
        
        await driver.get(`https://x.com/${username}`);
        await driver.sleep(2000);

        const isValid = await driver.executeScript(`
            function checkProfile() {
                const errorSelectors = [
                    '[data-testid="error-detail"]',
                    '.PageNotFound',
                    'div[class*="error"]',
                    'span[class*="error"]'
                ];
                
                for (let selector of errorSelectors) {
                    if (document.querySelector(selector)) {
                        return false;
                    }
                }

                const profileSelectors = [
                    '[data-testid="UserName"]',
                    '[data-testid="UserAvatar"]',
                    '[data-testid="primaryColumn"]'
                ];

                return profileSelectors.some(selector => document.querySelector(selector));
            }
            return checkProfile();
        `);

        await driver.close();
        await driver.switchTo().window(mainWindow);

        // Store result in cache
        validatedProfiles.set(username, Boolean(isValid));
        
        if (isValid) {
            elizaLogger.log(`✓ Valid profile found and cached: @${username}`);
        } else {
            elizaLogger.log(`✗ Invalid profile found and cached: @${username}`);
        }

        return Boolean(isValid);
    } catch (error) {
        elizaLogger.error(`Error validating ${username}:`, error);
        // Cache errors as invalid profiles
        validatedProfiles.set(username, false);
        return false;
    }
}

async function extractProfilesFromCurrentPage(driver: SeleniumWebDriver): Promise<string[]> {
    const pageSource = await driver.getPageSource();
    const visibleText = await driver.findElement(By.css('body')).getText();
    const combinedText = `${pageSource} ${visibleText}`;
    
    const profiles: string[] = [];
    const profilePattern = /(?:https?:\/\/)?(?:www\.)?(twitter\.com|x\.com)\/([a-zA-Z][a-zA-Z0-9_]{3,14})(?:\/)?(?=[\s"'<>}\]]|$)/gi;
    
    const matches = combinedText.matchAll(profilePattern);
    const potentialUsernames = new Set<string>();

    for (const match of matches) {
        const domain = match[1].toLowerCase();
        const username = match[2].toLowerCase();
        
        if (
            (domain === 'twitter.com' || domain === 'x.com') &&
            !username.includes('token') &&
            !username.includes('pump') &&
            !/^\d+$/.test(username) &&
            username.length >= 4 &&
            username.length <= 15 &&
            /^[a-z][a-z0-9_]*$/i.test(username) &&
            !['home', 'login', 'signup', 'explore', 'notifications', 'messages',
              'search', 'settings', 'privacy', 'about', 'help', 'status'].includes(username)
        ) {
            potentialUsernames.add(username);
        }
    }

    let validatedCount = 0;
    const totalToValidate = potentialUsernames.size;

    for (const username of potentialUsernames) {
        try {
            validatedCount++;
            
            // Show progress
            elizaLogger.log(`Validating profile ${validatedCount}/${totalToValidate}: @${username}`);
            
            // Check if already validated
            if (validatedProfiles.has(username)) {
                elizaLogger.log(`Using cached result for @${username}`);
                if (validatedProfiles.get(username)) {
                    profiles.push(username);
                }
                continue;
            }

            const isValid = await validateTwitterUsername(username, driver);
            if (isValid) {
                profiles.push(username);
            }
            
            await driver.sleep(1000);
            
        } catch (error) {
            elizaLogger.error(`Error validating ${username}:`, error);
        }
    }
    
    return profiles;
}
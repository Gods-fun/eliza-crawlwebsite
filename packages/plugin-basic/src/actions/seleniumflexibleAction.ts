import { Builder, By, until, WebDriver as SeleniumWebDriver } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome';
import { elizaLogger } from "@ai16z/eliza";
import {
    composeContext,
    generateText,
    ModelClass
} from "@ai16z/eliza";
import { ActionExample, Content, HandlerCallback, IAgentRuntime, Memory, State, Action } from "@ai16z/eliza";
import path from 'path';
import { Runtime } from 'tslog';

// Get ChromeDriver path
const chromedriverPath = require('chromedriver').path;
elizaLogger.log('ChromeDriver path:', chromedriverPath);

interface ExtractionConfig {
    selectors: string[];
    attribute?: string;
    transform?: (value: string, driver?: SeleniumWebDriver) => any | Promise<any>;
    validate?: (value: any) => boolean;
}

interface DataPattern {
    name: string;
    patterns: RegExp[];
    config: ExtractionConfig;
}

const dataPatterns: { [key: string]: DataPattern } = {
    email: {
        name: "Email Addresses",
        patterns: [/\b[\w\.-]+@[\w\.-]+\.\w+\b/gi],
        config: {
            selectors: ['a[href^="mailto:"]', '*:contains(@)'],
            validate: (email) => /^[\w\.-]+@[\w\.-]+\.\w+$/.test(email)
        }
    },
    phone: {
        name: "Phone Numbers",
        patterns: [/[\+]?[(]?[0-9]{3}[)]?[-\s\.]?[0-9]{3}[-\s\.]?[0-9]{4,6}/gi],
        config: {
            selectors: ['a[href^="tel:"]', '*:contains(+)', '*:contains(phone)']
        }
    },
    twitter: {
        name: "Twitter Profiles",
        patterns: [/(?:https?:\/\/)?(?:www\.)?(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]+)/i],
        config: {
            selectors: ['a[href*="twitter.com"]', 'a[href*="x.com"]'],
            transform: async (value: string, driver: SeleniumWebDriver) => {
                const username = value.split('/').pop()?.toLowerCase();
                if (username && await validateTwitterUsername(username, driver)) {
                    const currentTargetUsers = process.env.TWITTER_TARGET_USERS || "";
                    const currentUsers = currentTargetUsers.split(',').filter(u => u.trim());
                    const updatedUsers = [...new Set([...currentUsers, username])];
                    process.env.TWITTER_TARGET_USERS = updatedUsers.join(',');
                    elizaLogger.log(`Added ${username} to target users`);
                    return username;
                }
                return null;
            }
        }
    },
    linkedin: {
        name: "LinkedIn Profiles",
        patterns: [/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/(?:in|company)\/([^\/\s]+)/i],
        config: {
            selectors: ['a[href*="linkedin.com"]'],
            transform: (value: string) => {
                const match = value.match(/linkedin\.com\/(?:in|company)\/([^\/\s]+)/i);
                return match ? match[1] : value;
            }
        }
    },
    instagram: {
        name: "Instagram Profiles",
        patterns: [/(?:https?:\/\/)?(?:www\.)?instagram\.com\/([a-zA-Z0-9_\.]+)/i],
        config: {
            selectors: ['a[href*="instagram.com"]'],
            transform: (value: string) => {
                const match = value.match(/instagram\.com\/([a-zA-Z0-9_\.]+)/i);
                return match ? match[1] : value;
            }
        }
    },
    facebook: {
        name: "Facebook Profiles",
        patterns: [/(?:https?:\/\/)?(?:www\.)?facebook\.com\/([a-zA-Z0-9\.]+)/i],
        config: {
            selectors: ['a[href*="facebook.com"]'],
            transform: (value: string) => {
                const match = value.match(/facebook\.com\/([a-zA-Z0-9\.]+)/i);
                return match ? match[1] : value;
            }
        }
    },
    prices: {
        name: "Prices",
        patterns: [/\$\d+(?:\.\d{2})?/g],
        config: {
            selectors: [
                '[class*="price"]',
                '[class*="cost"]',
                '*:contains($)'
            ],
            transform: (value) => parseFloat(value.replace('$', ''))
        }
    },
    dates: {
        name: "Dates",
        patterns: [
            /\d{1,2}\/\d{1,2}\/\d{2,4}/g,
            /\d{4}-\d{2}-\d{2}/g
        ],
        config: {
            selectors: [
                '[class*="date"]',
                'time',
                '*[datetime]'
            ],
            attribute: 'datetime'
        }
    },
    restaurants: {
        name: "Restaurants",
        patterns: [
            /(?:restaurant|café|bistro|diner|pizzeria|eatery)/i
        ],
        config: {
            selectors: [
                '[itemtype*="Restaurant"]',
                '.restaurant-name',
                '.venue-name',
                '[class*="restaurant"]',
                '[class*="dining"]',
                '.menu-item',
                '.dish',
                '[class*="food"]',
                '[class*="hours"]',
                '[class*="location"]',
                '[class*="address"]',
                '[class*="rating"]',
                '[class*="review"]',
                '[class*="price"]',
                '[itemtype*="Restaurant"]',
                '[itemprop="servesCuisine"]',
                '[itemprop="address"]',
                '[itemprop="telephone"]'
            ],
            transform: (value) => {
                return {
                    name: value.match(/(?:name|title):\s*(.*)/i)?.[1],
                    cuisine: value.match(/cuisine:\s*(.*)/i)?.[1],
                    address: value.match(/address:\s*(.*)/i)?.[1],
                    hours: value.match(/hours:\s*(.*)/i)?.[1],
                    phone: value.match(/(?:phone|tel):\s*(.*)/i)?.[1],
                    price: value.match(/price:\s*(.*)/i)?.[1]
                };
            }
        }
    }
};

export const seleniumflexibleAction: Action = {
    name: "EXTRACT_DATA",
    similes: ["FIND_DATA", "GET_INFO", "SCRAPE_DATA"],
    description: "Extract any type of data from websites based on user request",
    
    validate: async (runtime: IAgentRuntime, message: Memory) => {
        const text = message.content.text.toLowerCase();
        return text.includes('find') || 
               text.includes('get') || 
               text.includes('extract') || 
               text.includes('show') ||
               text.includes('what');
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
            const dataTypes = await determineDataTypes(runtime, message.content.text);
            elizaLogger.log("dataTypes", dataTypes);
            elizaLogger.log("message.content.text", message.content.text);
            
            if (dataTypes.length === 0) {
                if (callback) {
                    callback({
                        text: "I'm not sure what type of data you want me to extract. Could you please be more specific?",
                        content: { error: "Unclear data type request" }
                    });
                }
                return false;
            }

            const websiteUrl = extractUrlFromMessage(message.content.text) || runtime.getSetting("WEBSITE_URL");
                             
            
            if (!websiteUrl) {
                throw new Error("No website URL provided or configured");
            }

            driver = await setupWebDriver();
            await driver.get(websiteUrl);

            const results: { [key: string]: any[] } = {};

            for (const dataType of dataTypes) {
                const pattern = dataPatterns[dataType];
                if (pattern) {
                    results[dataType] = await crawlAndExtract(driver, websiteUrl, pattern);
                }
            }

            if (callback) {
                callback({
                    text: formatExtractedData(results),
                    content: {
                        websiteUrl,
                        results
                    }
                });
            }

            return true;

        } catch (error) {
            elizaLogger.error('Error extracting data:', error);
            if (callback) {
                callback({
                    text: `Sorry, I encountered an error while extracting data: ${error.message}`,
                    content: { error: error.message }
                });
            }
            return false;
        } finally {
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
                    text: "Find email addresses and phone numbers from https://example.com"
                }
            },
            {
                user: "agent",
                content: {
                    text: "Here's what I found:\n\nEmail Addresses:\n- contact@example.com\n- support@example.com\n\nPhone Numbers:\n- (555) 123-4567\n- +1 555-987-6543",
                    action: "EXTRACT_DATA",
                    content: {
                        websiteUrl: "https://example.com",
                        results: {
                            email: ["contact@example.com", "support@example.com"],
                            phone: ["(555) 123-4567", "+1 555-987-6543"]
                        }
                    }
                }
            }
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Get all social media profiles from the website"
                }
            },
            {
                user: "agent",
                content: {
                    text: "Here's what I found:\n\nSocial Media Profiles:\n- Twitter: @company_handle\n- LinkedIn: /company/example-company\n- Instagram: @company.social\n- Facebook: /examplecompany",
                    action: "EXTRACT_DATA",
                    content: {
                        websiteUrl: "https://example.com",
                        results: {
                            socialMedia: [
                                "twitter.com/company_handle",
                                "linkedin.com/company/example-company",
                                "instagram.com/company.social",
                                "facebook.com/examplecompany"
                            ]
                        }
                    }
                }
            }
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "What are the prices on their products page?"
                }
            },
            {
                user: "agent",
                content: {
                    text: "Here's what I found:\n\nPrices:\n- $29.99\n- $49.99\n- $99.99\n- $199.99",
                    action: "EXTRACT_DATA",
                    content: {
                        websiteUrl: "https://example.com/products",
                        results: {
                            prices: [29.99, 49.99, 99.99, 199.99]
                        }
                    }
                }
            }
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "When are their business hours?"
                }
            },
            {
                user: "agent",
                content: {
                    text: "Here's what I found:\n\nDates/Times:\n- Monday-Friday: 9:00 AM - 5:00 PM\n- Saturday: 10:00 AM - 3:00 PM\n- Sunday: Closed",
                    action: "EXTRACT_DATA",
                    content: {
                        websiteUrl: "https://example.com/contact",
                        results: {
                            dates: ["Mon-Fri: 9-5", "Sat: 10-3", "Sun: Closed"]
                        }
                    }
                }
            }
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Find their contact information"
                }
            },
            {
                user: "agent",
                content: {
                    text: "Here's what I found:\n\nEmail Addresses:\n- info@example.com\n\nPhone Numbers:\n- (555) 123-4567\n\nSocial Media:\n- Twitter: @example\n\nAddress:\n- 123 Main St, City, State 12345",
                    action: "EXTRACT_DATA",
                    content: {
                        websiteUrl: "https://example.com/contact",
                        results: {
                            email: ["info@example.com"],
                            phone: ["(555) 123-4567"],
                            socialMedia: ["twitter.com/example"],
                            address: ["123 Main St, City, State 12345"]
                        }
                    }
                }
            }
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "What payment methods do they accept?"
                }
            },
            {
                user: "agent",
                content: {
                    text: "Here's what I found:\n\nPayment Methods:\n- Visa\n- Mastercard\n- PayPal\n- Apple Pay",
                    action: "EXTRACT_DATA",
                    content: {
                        websiteUrl: "https://example.com/checkout",
                        results: {
                            paymentMethods: [
                                "Visa",
                                "Mastercard",
                                "PayPal",
                                "Apple Pay"
                            ]
                        }
                    }
                }
            }
        ],
        // Twitter example
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Find Twitter profiles from the website"
                }
            },
            {
                user: "agent",
                content: {
                    text: "Here's what I found:\n\nTwitter Profiles:\n- @elonmusk\n- @jack\n- @twitter",
                    action: "EXTRACT_DATA",
                    content: {
                        websiteUrl: "https://example.com",
                        results: {
                            twitter: ["elonmusk", "jack", "twitter"]
                        }
                    }
                }
            }
        ],
        // LinkedIn example
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Extract LinkedIn profiles"
                }
            },
            {
                user: "agent",
                content: {
                    text: "Here's what I found:\n\nLinkedIn Profiles:\n- /in/satyanadella\n- /company/microsoft",
                    action: "EXTRACT_DATA",
                    content: {
                        websiteUrl: "https://example.com",
                        results: {
                            linkedin: ["satyanadella", "microsoft"]
                        }
                    }
                }
            }
        ],
        // Instagram example
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Get Instagram profiles"
                }
            },
            {
                user: "agent",
                content: {
                    text: "Here's what I found:\n\nInstagram Profiles:\n- @instagram\n- @zuck",
                    action: "EXTRACT_DATA",
                    content: {
                        websiteUrl: "https://example.com",
                        results: {
                            instagram: ["instagram", "zuck"]
                        }
                    }
                }
            }
        ],
        // Facebook example
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Find Facebook profiles"
                }
            },
            {
                user: "agent",
                content: {
                    text: "Here's what I found:\n\nFacebook Profiles:\n- /zuck\n- /meta",
                    action: "EXTRACT_DATA",
                    content: {
                        websiteUrl: "https://example.com",
                        results: {
                            facebook: ["zuck", "meta"]
                        }
                    }
                }
            }
        ]
    ] as ActionExample[][]
};

async function generateDataPattern(runtime: IAgentRuntime, dataType: string): Promise<DataPattern | null> {
    try {
        const prompt = `Create a data extraction pattern for "${dataType}" with the following JSON structure:
{
    "name": "Human readable name",
    "patterns": ["Array of regex patterns to match the data"],
    "config": {
        "selectors": ["Array of CSS selectors to find elements containing this data"],
        "transform": "Optional transformation logic",
        "validate": "Optional validation logic"
    }
}
Example for email: {
    "name": "Email Addresses",
    "patterns": ["\\b[\\w\\.-]+@[\\w\\.-]+\\.\\w+\\b"],
    "config": {
        "selectors": ["a[href^=\\"mailto:\\"]", "*:contains(@)"]
    }`;

        const response = await generateText({
            runtime: runtime,
            context: prompt,
            modelClass: ModelClass.SMALL,
            stop: ["}"]
        });

        if (typeof response === 'string') {
            const pattern = JSON.parse(response);
            return validateAndTransformPattern(pattern);
        } else {
            throw new Error('Invalid response format from generateText');
        }
    } catch (error) {
        elizaLogger.error('Error generating data pattern:', error);
        return null;
    }
}

async function determineDataTypes(runtime: IAgentRuntime, text: string): Promise<string[]> {
    const types: string[] = [];
    text = text.toLowerCase();

    for (const [key, pattern] of Object.entries(dataPatterns)) {
        if (text.includes(key) || 
            text.includes(pattern.name.toLowerCase()) ||
            pattern.patterns.some(p => p.test(text))) {
            types.push(key);
        }
    }
    elizaLogger.log("types", types);

    // If no known patterns found, try to determine type from text
    if (types.length === 0) {
        const prompt = `What type of data is being requested in: "${text}"? 
                       Respond with a single word (e.g., email, phone, prices, etc.)`;
        const dataType = await generateText({
            runtime: runtime,
            context: prompt,
            modelClass: ModelClass.SMALL
        });
        elizaLogger.log("dataType", dataType);

        if (typeof dataType === 'string' && !dataPatterns[dataType]) {
            const newPattern = await generateDataPattern(runtime, dataType);
            if (newPattern) {
                dataPatterns[dataType] = newPattern;
                types.push(dataType);
            }
        }
    }

    return types;
}

async function crawlAndExtract(driver: SeleniumWebDriver, baseUrl: string, pattern: DataPattern): Promise<any[]> {
    const results = new Set();
    const visitedUrls = new Set([baseUrl]);
    const urlsToVisit = [baseUrl];

    while (urlsToVisit.length > 0 && visitedUrls.size < 10) {
        const currentUrl = urlsToVisit.shift()!;
        try {
            await driver.get(currentUrl);
            // Wait for page load
            await driver.wait(until.elementLocated(By.tagName('body')), 10000);

            // Add wait for dynamic content
            await driver.sleep(2000); // Wait for dynamic content to load

            // Extract data from current page with retry mechanism
            const pageResults = await retryOperation(
                async () => extractDataByPattern(driver, pattern),
                3,
                1000,
                driver
            );
            pageResults.forEach(result => results.add(result));

            // Find and interact with navigation elements with retry and refresh
            const interactiveElements = await driver.findElements(By.css(`
                nav a, .nav-link, button:not([disabled]), [role="button"]
            `));

            for (const element of interactiveElements) {
                try {
                    // Verify element is still valid and visible
                    const isDisplayed = await retryOperation(async () => {
                        await driver.wait(until.elementIsVisible(element), 5000);
                        return await element.isDisplayed();
                    }, 3);

                    if (!isDisplayed) continue;

                    // Get current state
                    const beforeState = await driver.executeScript('return document.documentElement.outerHTML');
                    
                    // Click with retry
                    await retryOperation(async () => {
                        await driver.executeScript('arguments[0].scrollIntoView(true)', element);
                        await driver.wait(until.elementIsVisible(element), 5000);
                        await element.click();
                    }, 3);

                    // Wait for any changes
                    await driver.sleep(1000);

                    // Check new state
                    const afterState = await driver.executeScript('return document.documentElement.outerHTML');
                    if (beforeState !== afterState) {
                        const newResults = await extractDataByPattern(driver, pattern);
                        newResults.forEach(result => results.add(result));
                    }

                } catch (error) {
                    elizaLogger.error('Error interacting with element:', error);
                    continue; // Skip problematic elements
                }
            }

        } catch (error) {
            elizaLogger.error('Error processing URL:', error);
            continue; // Skip problematic URLs
        }
    }

    return Array.from(results);
}

// Helper function for retrying operations
async function retryOperation<T>(
    operation: () => Promise<T>, 
    maxRetries: number = 3,
    delay: number = 1000,
    driver?: SeleniumWebDriver // Add driver parameter
): Promise<T> {
    let lastError;
    
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;
            if (error.name === 'StaleElementReferenceError' && driver) {
                await driver.navigate().refresh();
                await driver.sleep(delay);
                continue;
            }
            if (i === maxRetries - 1) throw error;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    
    throw lastError;
}


// Update extractDataByPattern to handle stale elements
async function extractDataByPattern(
    driver: SeleniumWebDriver, 
    pattern: DataPattern
): Promise<any[]> {
    const results = new Set();

    try {
        // Wait for content to be available
        await driver.wait(until.elementLocated(By.css('body')), 10000);
        
        for (const selector of pattern.config.selectors) {
            try {
                // Find elements with retry
                const elements = await retryOperation(
                    async () => driver.findElements(By.css(selector)),
                    3,
                    1000,
                    driver
                );

                for (const element of elements) {
                    try {
                        // Get element text with retry
                        const text = await retryOperation(async () => {
                            return pattern.config.attribute ?
                                await element.getAttribute(pattern.config.attribute) :
                                await element.getText();
                        });

                        if (text) {
                            for (const regex of pattern.patterns) {
                                const matches = text.match(regex);
                                if (matches) {
                                    matches.forEach(match => {
                                        let value = match;
                                        if (pattern.config.transform) {
                                            value = pattern.config.transform(match);
                                        }
                                        if (!pattern.config.validate || pattern.config.validate(value)) {
                                            results.add(value);
                                        }
                                    });
                                }
                            }
                        }
                    } catch (error) {
                        continue; // Skip problematic elements
                    }
                }
            } catch (error) {
                continue; // Skip problematic selectors
            }
        }
    } catch (error) {
        elizaLogger.error('Error in extractDataByPattern:', error);
    }

    return Array.from(results);
}

function formatExtractedData(results: { [key: string]: any[] }): string {
    let response = "Here's what I found:\n\n";

    for (const [type, data] of Object.entries(results)) {
        if (data.length > 0) {
            response += `${dataPatterns[type].name}:\n`;
            data.forEach(item => {
                response += `- ${item}\n`;
            });
            response += '\n';
        }
    }

    if (response === "Here's what I found:\n\n") {
        response = "I couldn't find any of the requested data on this website.";
    }

    return response;
}

function extractUrlFromMessage(text: string): string | undefined {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const matches = text.match(urlRegex);
    return matches ? matches[0] : undefined;
}

async function setupWebDriver(): Promise<SeleniumWebDriver> {
    const options = new chrome.Options();
    options.setBinaryPath('/usr/bin/google-chrome');
    options.addArguments(
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-extensions',
        '--window-size=1920,1080'
    );

    const display = process.env.DISPLAY || ':0';
    if (display) {
        options.addArguments(`--display=${display}`);
    }

    const serviceBuilder = new chrome.ServiceBuilder(chromedriverPath)
        .setPort(9515)
        .enableVerboseLogging()
        .loggingTo('chromedriver.log');

    return new Builder()
        .forBrowser('chrome')
        .setChromeOptions(options)
        .setChromeService(serviceBuilder)
        .build();
}

const validatedProfiles = new Map<string, boolean>();

async function validateTwitterUsername(username: string, driver: SeleniumWebDriver): Promise<boolean> {
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

        validatedProfiles.set(username, Boolean(isValid));
        
        if (isValid) {
            elizaLogger.log(`✓ Valid profile found and cached: @${username}`);
        } else {
            elizaLogger.log(`✗ Invalid profile found and cached: @${username}`);
        }

        return Boolean(isValid);
    } catch (error) {
        elizaLogger.error(`Error validating ${username}:`, error);
        validatedProfiles.set(username, false);
        return false;
    }
}

function validateAndTransformPattern(pattern: any): DataPattern | null {
    if (!pattern.name || !pattern.patterns || !pattern.config) {
        elizaLogger.error('Invalid pattern structure:', pattern);
        return null;
    }

    // Convert string functions to actual functions
    if (typeof pattern.config.transform === 'string') {
        pattern.config.transform = new Function('value', 'driver', pattern.config.transform);
    }
    if (typeof pattern.config.validate === 'string') {
        pattern.config.validate = new Function('value', pattern.config.validate);
    }

    return pattern as DataPattern;
}

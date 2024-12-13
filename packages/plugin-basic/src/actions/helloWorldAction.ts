import { composeContext, elizaLogger } from "@ai16z/eliza";
import { generateMessageResponse, generateTrueOrFalse } from "@ai16z/eliza";
import { booleanFooter, messageCompletionFooter } from "@ai16z/eliza";

import {
    Action,
    ActionExample,
    Content,
    HandlerCallback,
    IAgentRuntime,
    Memory,
    ModelClass,
    State,
} from "@ai16z/eliza";


export const helloWorldAction: Action = {
    name: "HELLO_WORLD",
    similes: ["HELLOWORLD", "WORLD"],
    description:
        "create a cool asci art of Hello World.",
    validate: async (runtime: IAgentRuntime, message: Memory) => {
        return true;
    },
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        options: any,
        callback: HandlerCallback
    ) => {
        const helloWorldAscii = `
  _   _      _ _        __        __         _     _ 
 | | | | ___| | | ___   \\ \\      / /__  _ __| | __| |
 | |_| |/ _ \\ | |/ _ \\   \\ \\ /\\ / / _ \\| '__| |/ _\` |
 |  _  |  __/ | | (_) |   \\ V  V / (_) | |  | | (_| |
 |_| |_|\\___|_|_|\\___/     \\_/\\_/ \\___/|_|  |_|\\__,_|
                                                     
        `;
        

        if (!state) {
            state = (await runtime.composeState(message)) as State;
        }

        state = await runtime.updateRecentMessageState(state);

       

        await callback(
            {
                text: "hello world action completed",
            }
        );

       

        return true;
    },
    examples: [
        [
            {
                user: "{{user1}}",
                content: {
                    text: "can you generate a hello world ascii art",
                },
            },
            {
                user: "{{user2}}",
                content: { text: "sure, here you go:", action: "HELLO_WORLD" },
            },
            {
                user: "{{user2}}",
                content: {
                    text: `
  _   _      _ _        __        __         _     _ 
 | | | | ___| | | ___   \\ \\      / /__  _ __| | __| |
 | |_| |/ _ \\ | |/ _ \\   \\ \\ /\\ / / _ \\| '__| |/ _\` |
 |  _  |  __/ | | (_) |   \\ V  V / (_) | |  | | (_| |
 |_| |_|\\___|_|_|\\___/     \\_/\\_/ \\___/|_|  |_|\\__,_|
                                                     
                    `,
                },
            },
        ],
        
        [
            {
                user: "{{user1}}",
                content: {
                    text: "generate hello world ascii art please",  
                },
            },
            {
                user: "{{user2}}",
                content: { text: "coming right up!", action: "HELLO_WORLD" },
            },
            {
                user: "{{user2}}",
                content: {
                    text: `
  _   _      _ _        __        __         _     _ 
 | | | | ___| | | ___   \\ \\      / /__  _ __| | __| |
 | |_| |/ _ \\ | |/ _ \\   \\ \\ /\\ / / _ \\| '__| |/ _\` |
 |  _  |  __/ | | (_) |   \\ V  V / (_) | |  | | (_| |
 |_| |_|\\___|_|_|\\___/     \\_/\\_/ \\___/|_|  |_|\\__,_|
                                                     
                    `,
                },
            },
        ],

        [
            {  
                user: "{{user1}}",
                content: {
                    text: "i need a hello world ascii art, can you make one",
                },
            },
            {   
                user: "{{user2}}",
                content: { text: "absolutely, check this out:", action: "HELLO_WORLD" },
            },
            {
                user: "{{user2}}",
                content: {
                    text: `
  _   _      _ _        __        __         _     _ 
 | | | | ___| | | ___   \\ \\      / /__  _ __| | __| |
 | |_| |/ _ \\ | |/ _ \\   \\ \\ /\\ / / _ \\| '__| |/ _\` |
 |  _  |  __/ | | (_) |   \\ V  V / (_) | |  | | (_| |
 |_| |_|\\___|_|_|\\___/     \\_/\\_/ \\___/|_|  |_|\\__,_|
                                                     
                    `,  
                },
            },
            {
                user: "{{user1}}",
                content: {
                    text: "that's awesome, thanks!",
                },
            },
        ],
    ] as ActionExample[][],
} as Action;

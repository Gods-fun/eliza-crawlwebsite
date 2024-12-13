import { Plugin } from "@ai16z/eliza";
import { helloWorldAction } from "./actions/helloWorldAction.ts";
import {seleniumProfilesAction} from "./actions/seleniumProfilesAction.ts"
export * as actions from "./actions";
export * as evaluators from "./evaluators";
export * as providers from "./providers";

export const basicPlugin: Plugin = {
    name: "basic",
    description: "Agent bootstrap with basic actions and evaluators",
    actions: [
      helloWorldAction,
      seleniumProfilesAction,
    ],
    evaluators: [],
    providers: [],
};

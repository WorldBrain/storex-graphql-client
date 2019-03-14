import { StorageModuleInterface, PublicMethodDefinition, ensureDetailedPublicMethodValue, PublicMethodDetailedArg } from '@worldbrain/storex-pattern-modules'

export interface StorexGraphQLClientOptions {
    endpoint : string
    modules : {[name : string]: StorageModuleInterface}
    fetch? : typeof fetch
}
export class StorexGraphQLClient {
    constructor(private options : StorexGraphQLClientOptions) {
    }

    async executeQuery(options : {query : string}) {
        const response = await this.options.fetch(this.options.endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
            body: JSON.stringify({query: options.query})
        })
        return response.json()
    }

    getModules<Modules = {[module : string] : {[name : string] : (...args) => Promise<any>}}>() : Modules {
        const modules = {}
        for (const name of Object.keys(this.options.modules)) {
            modules[name] = this.getModule(name)
        }
        return modules as Modules
    }

    getModule<Module = {[name : string] : (...args) => Promise<any>}>(moduleName : string) {
        const methods = {}
        for (const [methodName, methodDefinition] of Object.entries(this.options.modules[moduleName].getConfig().methods)) {
            methods[methodName] = async (...args) => {
                const query = this._convertCallToQuery(args, { moduleName, methodName, methodDefinition })
                const response = await this.executeQuery({ query })
                return response['data']
            }
        }
        return methods as Module
    }

    _convertCallToQuery(args : any[], options : { moduleName : string, methodName : string, methodDefinition : PublicMethodDefinition }) {
        const argList = this._convertArgListToQuery(args, { methodDefinition: options.methodDefinition })
        return `query { ${options.moduleName} { ${options.methodName}${argList} } }`
    }

    _convertArgListToQuery(args : any[], options : { methodDefinition : PublicMethodDefinition }) {
        const argPairs : [any, any][] = []
        for (const [argName, argDefinition] of Object.entries(options.methodDefinition.args)) {
            const detailedArg = ensureDetailedPublicMethodValue(argDefinition) as PublicMethodDetailedArg

            let argValue : any
            if (detailedArg.positional) {
                argValue = args.shift()
            } else {
                argValue = args[0][argName]
            }
            argPairs.push([argName, JSON.stringify(argValue)])
        }
        if (!argPairs.length) {
            return ''
        }

        const argList = argPairs.map(([key, value]) => `${key}: ${value}`).join(', ')
        return `(${argList})`
    }
}

import { StorageRegistry } from '@worldbrain/storex';
import { StorageModuleInterface, PublicMethodDefinition, ensureDetailedPublicMethodValue, PublicMethodDetailedArg, PublicMethodValue, isPublicMethodCollectionType, isPublicMethodArrayType } from '@worldbrain/storex-pattern-modules'

export interface StorexGraphQLClientOptions {
    endpoint : string
    modules : {[name : string]: StorageModuleInterface}
    storageRegistry : StorageRegistry
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
                return response['data'][moduleName][methodName]
            }
        }
        return methods as Module
    }

    _convertCallToQuery(args : any[], options : { moduleName : string, methodName : string, methodDefinition : PublicMethodDefinition }) {
        const argList = this._convertArgListToQuery(args, { methodDefinition: options.methodDefinition })
        const afterMethodName = [argList]

        const returns = options.methodDefinition.returns
        if (typeof returns !== 'string' || returns === 'void') {
            afterMethodName.push(this._convertReturnValueToQuery(returns))
        }

        return `query { ${options.moduleName} { ${options.methodName}${afterMethodName.join(' ')} } }`
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

    _convertReturnValueToQuery(returns : PublicMethodValue | 'void') {
        if (returns === 'void') {
            return '{ void }'
        }

        let detailedReturnValue = ensureDetailedPublicMethodValue(returns)
        if (isPublicMethodArrayType(detailedReturnValue.type)) {
            detailedReturnValue = ensureDetailedPublicMethodValue(detailedReturnValue.type.array)
        }

        if (isPublicMethodCollectionType(detailedReturnValue.type)) {
            const collectionDefinition = this.options.storageRegistry.collections[detailedReturnValue.type.collection]
            const fieldNames = Object.keys(collectionDefinition.fields).join(', ')
            return `{ ${fieldNames} }`
        }
        throw new Error(`Don't know how to consume method returning '${JSON.stringify(detailedReturnValue.type)}'`)
    }
}

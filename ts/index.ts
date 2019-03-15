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

    async executeRequest(options : { query : string, variables: {[name : string] : any}, type : 'query' | 'mutation' }) {
        const response = await this.options.fetch(this.options.endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
            body: JSON.stringify({query: options.query, variables: options.variables})
        })
        return response.json()
    }

    async executeCall(moduleName : string, methodName : string, args : any[]) {
        const methodDefinition = this.options.modules[moduleName].getConfig().methods[methodName]
        const query = this._convertCallToQuery(args, { moduleName, methodName, methodDefinition })
        const variables = this._getCallVariables(args, { moduleName, methodName, methodDefinition })
        const response = await this.executeRequest({ query, variables, type: methodDefinition.type })
        if (response['errors']) {
            throw new Error(`GraphQL error(s): ${JSON.stringify(response.errors.map(e => e.message))}`)
        }
        return response['data'][moduleName][methodName]
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
        for (const methodName of Object.keys(this.options.modules[moduleName].getConfig().methods)) {
            methods[methodName] = async (...args) => {
                return this.executeCall(moduleName, methodName, args)
            }
        }
        return methods as Module
    }
    _getCallVariables(args : any[], options : { moduleName : string, methodName : string, methodDefinition : PublicMethodDefinition }): any {
        args = [...args]

        const variables = {}
        for (const [argName, argDefinition] of Object.entries(options.methodDefinition.args)) {
            const detailedArg = ensureDetailedPublicMethodValue(argDefinition) as PublicMethodDetailedArg
            const argValue = detailedArg.positional ? args.shift() : args[0][argName]

            if (shouldBeVariableArgument(detailedArg)) {
                variables[argName] = argValue
            }
        }
        return variables
    }

    _convertCallToQuery(args : any[], options : { moduleName : string, methodName : string, methodDefinition : PublicMethodDefinition }) {
        const argList = this._convertArgListToQuery(args, { methodDefinition: options.methodDefinition })
        const afterMethodName = [argList]

        const returns = this._convertReturnValueToQuery(options.methodDefinition.returns)
        if (returns) {
            afterMethodName.push(returns)
        }

        const type = options.methodDefinition.type === 'mutation' ? 'mutation ' : ''

        return `${type}{ ${options.moduleName} { ${options.methodName}${afterMethodName.join(' ')} } }`
    }

    _convertArgListToQuery(args : any[], options : { methodDefinition : PublicMethodDefinition }) {
        args = [...args]
        const argPairs : [any, any][] = []
        for (const [argName, argDefinition] of Object.entries(options.methodDefinition.args)) {
            const detailedArg = ensureDetailedPublicMethodValue(argDefinition) as PublicMethodDetailedArg

            let argValue : any
            if (!shouldBeVariableArgument(detailedArg)) {
                if (detailedArg.positional) {
                    argValue = args.shift()
                } else {
                    argValue = args[0][argName]
                }
                argValue = JSON.stringify(argValue)
            } else {
                argValue = `$${argName}`
            }
            argPairs.push([argName, argValue])
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

        if (typeof detailedReturnValue.type === 'string') {
            return null
        }

        if (isPublicMethodCollectionType(detailedReturnValue.type)) {
            const collectionDefinition = this.options.storageRegistry.collections[detailedReturnValue.type.collection]
            const fieldNames = Object.keys(collectionDefinition.fields).join(', ')
            return `{ ${fieldNames} }`
        }
        throw new Error(`Don't know how to consume method returning '${JSON.stringify(detailedReturnValue.type)}'`)
    }
}

function shouldBeVariableArgument(detailedArg : PublicMethodDetailedArg) {
    return (
        isPublicMethodCollectionType(detailedArg.type) ||
        (isPublicMethodArrayType(detailedArg.type) && isPublicMethodCollectionType(detailedArg.type.array))
    )
}
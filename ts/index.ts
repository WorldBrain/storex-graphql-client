import { StorageRegistry } from '@worldbrain/storex';
import { StorageModuleInterface, PublicMethodDefinition, ensureDetailedPublicMethodValue, PublicMethodDetailedArg, PublicMethodValue, isPublicMethodCollectionType, isPublicMethodArrayType } from '@worldbrain/storex-pattern-modules'
import { capitalize } from './utils';
import { StorexGraphQLClientLogEvent as StorexGraphQLClientObserverEvent } from './types';

export interface StorexGraphQLClientOptions {
    endpoint : string
    modules : {[name : string]: StorageModuleInterface}
    storageRegistry : StorageRegistry
    fetch? : typeof fetch
    observer? : (event : StorexGraphQLClientObserverEvent) => void
}

type CallVariables = {[key : string] : any}
export class StorexGraphQLClient {
    constructor(private options : StorexGraphQLClientOptions) {
    }

    async executeRequest(options : { query : string, variables: {[name : string] : any}, type : 'query' | 'mutation' }) {
        const body = JSON.stringify({ query: options.query, variables: options.variables })
        this._log({ type: 'request-prepared', query: options.query, variables: options.variables, body })
        const response = await this.options.fetch(this.options.endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
            body: body
        })
        const parsedBody = await response.json()
        this._log({ type: 'response-received', parsedBody })
        return parsedBody
    }

    async executeCall(moduleName : string, methodName : string, args : any[]) {
        this._log({ type: 'preparing-request', module: moduleName, method: methodName, args})

        const methodDefinition = this.options.modules[moduleName].getConfig().methods[methodName]
        const variables = this._getCallVariables(args, { moduleName, methodName, methodDefinition })
        const query = this._convertCallToQuery(args, { moduleName, methodName, methodDefinition, variables })
        const response = await this.executeRequest({ query, variables, type: methodDefinition.type })
        if (response['errors']) {
            throw new Error(`GraphQL error(s): ${JSON.stringify(response.errors.map(e => e.message))}`)
        }
        const returnValue = response['data'][moduleName][methodName]
        this._log({ type: 'call-processed', module: moduleName, method: methodName, args, returnValue})
        return returnValue
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

    _getCallVariables(args : any[], options : {
        moduleName : string, methodName : string, methodDefinition : PublicMethodDefinition
    }): CallVariables {
        args = [...args]

        const variables = {}
        for (const [argName, argDefinition] of Object.entries(options.methodDefinition.args)) {
            const detailedArg = ensureDetailedPublicMethodValue(argDefinition) as PublicMethodDetailedArg
            const argValue = detailedArg.positional ? args.shift() : args[0][argName]

            if (_shouldBeVariableArgument(detailedArg)) {
                variables[argName] = argValue
            }
        }
        return variables
    }

    _convertCallToQuery(args : any[], options : {
        moduleName : string, methodName : string, methodDefinition : PublicMethodDefinition, variables : CallVariables
    }) {
        const argList = this._convertArgListToQuery(args, { methodDefinition: options.methodDefinition })
        const afterMethodName = [argList]

        const returns = this._convertReturnValueToQuery(options.methodDefinition.returns)
        if (returns) {
            afterMethodName.push(returns)
        }

        let queryArgs = ''
        if (Object.keys(options.variables).length) {
            const variableStrings = Object.keys(options.variables).map(
                varName => `$${varName}: ${this._convertSchemaArgToGraphQL(options.methodDefinition.args[varName])}`
            )
            queryArgs = `MethodCall(${variableStrings}) `
        }

        const type = options.methodDefinition.type
        return `${type} ${queryArgs}{ ${options.moduleName} { ${options.methodName}${afterMethodName.join(' ')} } }`
    }

    _convertSchemaArgToGraphQL(arg : PublicMethodValue): any {
        const detailedArg = ensureDetailedPublicMethodValue(arg)

        let typeString
        if (isPublicMethodCollectionType(detailedArg.type)) {
            typeString = capitalize(detailedArg.type.collection) + 'Input'
        } else if (isPublicMethodArrayType(detailedArg.type)) {
            const detailedArrayValue = ensureDetailedPublicMethodValue(detailedArg.type.array)

            let valueTypeString
            if (isPublicMethodCollectionType(detailedArrayValue.type)) {
                valueTypeString = capitalize(detailedArrayValue.type.collection) + 'Input'
            }
            if (!detailedArrayValue.optional) {
                valueTypeString += '!'
            }
            typeString = `[${valueTypeString}]`            
        }
        if (!detailedArg.optional) {
            typeString += '!'
        }

        return typeString
    }

    _convertArgListToQuery(args : any[], options : { methodDefinition : PublicMethodDefinition }) {
        args = [...args]
        const argPairs : [any, any][] = []
        for (const [argName, argDefinition] of Object.entries(options.methodDefinition.args)) {
            const detailedArg = ensureDetailedPublicMethodValue(argDefinition) as PublicMethodDetailedArg

            let argValue : any
            if (!_shouldBeVariableArgument(detailedArg)) {
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

    _log(event : StorexGraphQLClientObserverEvent) {
        if (this.options.observer) {
            this.options.observer(event)
        }
    }
}

export function storexGraphQLClientLogger(options : { eventTypes : string[] | 'all' }) {
    const eventTypes = new Set(options.eventTypes)
    return (event : StorexGraphQLClientObserverEvent) => {
        if (options.eventTypes === 'all' || eventTypes.has(event.type)) {
            console.log('Storex GraphQL client event', event)
        }
    }
}

function _shouldBeVariableArgument(detailedArg : PublicMethodDetailedArg) {
    return (
        isPublicMethodCollectionType(detailedArg.type) ||
        (isPublicMethodArrayType(detailedArg.type) && isPublicMethodCollectionType(detailedArg.type.array))
    )
}
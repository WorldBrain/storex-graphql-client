import expect from 'expect'
import * as graphql from 'graphql'
import { StorexGraphQLClient } from '.';
import StorageManager, { StorageRegistry } from '@worldbrain/storex';
import {
    StorageModuleConfig, StorageModuleInterface, StorageModule, registerModuleMapCollections,
    PublicMethodDefinition, StorageModuleCollections } from '@worldbrain/storex-pattern-modules';
import { setupStorexTest } from '@worldbrain/storex-pattern-modules/lib/index.tests';
import { setupTestGraphQLStorexClient } from './index.tests';

describe('StorexGraphQLClient', () => {
    async function setupTest(options : { modules : {[name : string] : StorageModuleInterface }, respond? : (...args) => Promise<any>, fetch? : (...args) => Promise<any>}) {
        const storageRegistry = new StorageRegistry()
        registerModuleMapCollections(storageRegistry, options.modules)

        const client = new StorexGraphQLClient({ endpoint: null, fetch: options.fetch, modules: options.modules, storageRegistry })
        const queries = []
        if (options.respond) {
            client.executeRequest = async (...args) => {
                queries.push(args)
                return options.respond(args)
            }
        }
        return { client, queries }
    }

    interface MethodTestOptions {
        collections : StorageModuleCollections,
        methodDefinition : PublicMethodDefinition,
        methodImplementation : (...args) => Promise<any>,
        otherMethods? : {[name : string] : {definition : PublicMethodDefinition, implementation : (...args) => Promise<any>}}
        callArgs : any[]
        expectedQuery : any
    }
    async function setupMethodTest(options : MethodTestOptions & { setupServerModules? : boolean }) {
        let serverInfo = { lastMethodReponse: null }

        const moduleConfig = {
            collections: options.collections,
            methods: {
                testMethod: options.methodDefinition,
            }
        }
        if (options.otherMethods) {
            for (const [methodName, { definition }] of Object.entries(options.otherMethods)) {
                moduleConfig.methods[methodName] = definition
            }
        }

        class ClientTestModule implements StorageModuleInterface {
            getConfig = () : StorageModuleConfig => moduleConfig
        }
        class ServerTestModule extends StorageModule {
            getConfig = () : StorageModuleConfig => moduleConfig

            async testMethod(...args) {
                return serverInfo.lastMethodReponse = await options.methodImplementation(...args)
            }
        }
        if (options.otherMethods) {
            for (const [methodName, { implementation }] of Object.entries(options.otherMethods)) {
                ServerTestModule.prototype[methodName] = implementation
            }
        }

        let storageManager : StorageManager = null
        let serverModules : {[name : string] : StorageModuleInterface} = null
        if (options.setupServerModules) {
            const serverTestSetup = await setupStorexTest<{test : ServerTestModule}>({
                collections: {},
                modules: {
                    test: ({storageManager}) => new ServerTestModule({storageManager})
                }
            })
            storageManager = serverTestSetup.storageManager
            serverModules = serverTestSetup.modules
        }
        
        return { clientModules: { test: new ClientTestModule() }, storageManager, serverModules, serverInfo }
    }
    async function runMethodUnitTest(options : MethodTestOptions) {
        const { clientModules: modules } = await setupMethodTest(options)
        let expectedResponse
        const { client, queries } = await setupTest({
            modules: modules,
            respond: async (...args) => ({ data: { test: { testMethod: (expectedResponse = await options.methodImplementation(...args)) } } })
        })
        const result = await client.getModules().test.testMethod(...options.callArgs)
        expect(queries).toEqual([[options.expectedQuery]])
        expect(result).toEqual(expectedResponse)
    }

    async function runMethodIntegrationTest(options : MethodTestOptions) {
        const { storageManager, serverModules, serverInfo, clientModules } = await setupMethodTest({ ...options, setupServerModules: true })
        
        const { client } = setupTestGraphQLStorexClient({
            clientModules,
            serverModules,
            storageRegistry: storageManager.registry,
            autoPkType: 'int',
            graphql,
        })
        const result = await client.getModules().test.testMethod(...options.callArgs)
        expect(result).toEqual(serverInfo.lastMethodReponse)
    }

    it('should correctly execute queries', async () => {
        const fetches = []
        const fakeResponse = { data: { hello: "Hello world!" } }
        const fetch = async (...args) => {
            fetches.push(args)
            return { json: async () => fakeResponse }
        }
        const endpoint = 'https://my.api/graphql';
        const client = new StorexGraphQLClient({ endpoint: endpoint, fetch: fetch as any, modules: null, storageRegistry: null })
        const result = await client.executeRequest({query: '{ hello }', variables: {foo: 'bar'}, type: 'query'})
        expect(fetches).toEqual([
            [endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
                body: '{"query":"{ hello }","variables":{"foo":"bar"}}'
            }]
        ])
        expect(result).toEqual(fakeResponse)
    })

    const TESTS : {[description : string] : MethodTestOptions} = {
        'should correctly generate read-only queries': {
            collections: {},
            methodDefinition: { type: 'query', args: { name: 'string' }, returns: 'int' },
            methodImplementation: async () => 5,
            callArgs: [{name: 'John'}],
            expectedQuery: { query: `query { test { testMethod(name: "John") } }`, variables: {}, type: 'query' }
        },
        'should correctly generate read-only queries with positional args': {
            collections: {},
            methodDefinition: {
                type: 'query',
                args: {
                    first: { type: 'string', positional: true },
                    second: { type: 'string', positional: true },
                    third: { type: 'string' },
                },
                returns: 'int',
            },
            methodImplementation: async () => 5,
            callArgs: ['foo', 'bar', { third: 'eggs' }],
            expectedQuery: { query: `query { test { testMethod(first: "foo", second: "bar", third: "eggs") } }`, variables: {}, type: 'query' }
        },
        'should correctly select a collection return value': {
            collections: {
                user: {
                    version: new Date(),
                    fields: {
                        displayName: { type: 'string' },
                        age: { type: 'int' },
                    }
                }
            },
            methodDefinition: { type: 'query', args: {}, returns: { collection: 'user' }, },
            methodImplementation: async () => ({ displayName: 'Joe', age: 30, id: 55 }),
            callArgs: [],
            expectedQuery: { query: `query { test { testMethod { displayName, age, id } } }`, variables: {}, type: 'query' }
        },
        'should correctly select a collection array return value': {
            collections: {
                user: {
                    version: new Date(),
                    fields: {
                        displayName: { type: 'string' },
                        age: { type: 'int' },
                    }
                }
            },
            methodDefinition: { type: 'query', args: {}, returns: { array: { collection: 'user' } }, },
            methodImplementation: async () => [
                { displayName: 'Joe', age: 30, id: 22 },
                { displayName: 'Bob', age: 40, id: 21 },
            ],
            callArgs: [],
            expectedQuery: { query: `query { test { testMethod { displayName, age, id } } }`, variables: {}, type: 'query' }
        },
        'should correctly handle a scalar array return value': {
            collections: {},
            methodDefinition: { type: 'query', args: { name: 'string' }, returns: { array: 'int' } },
            methodImplementation: async () => [5, 7, 3],
            callArgs: [{name: 'John'}],
            expectedQuery: { query: `query { test { testMethod(name: "John") } }`, variables: {}, type: 'query' }
        },
        'should correctly handle void return values': {
            collections: {},
            methodDefinition: { type: 'query', args: { name: 'string' }, returns: 'void' },
            methodImplementation: async () => null,
            callArgs: [{ name: 'John' }],
            expectedQuery: { query: `query { test { testMethod(name: "John") { void } } }`, variables: {}, type: 'query' }
        },
        'should correctly pass collections in as arguments': {
            collections: {
                user: {
                    version: new Date(),
                    fields: {
                        displayName: { type: 'string' },
                        age: { type: 'int' },
                    }
                }
            },
            methodDefinition: {
                type: 'query',
                args: { user: { collection: 'user' } },
                returns: 'int',
            },
            methodImplementation: async () => 5,
            callArgs: [{ user: { displayName: 'Joe', age: 30 } }],
            expectedQuery: {
                query: `query MethodCall($user: UserInput!) { test { testMethod(user: $user) } }`,
                variables: { user: { displayName: 'Joe', age: 30 } },
                type: 'query',
            }
        },
        'should correctly pass collection arrays as arguments': {
            collections: {
                user: {
                    version: new Date(),
                    fields: {
                        displayName: { type: 'string' },
                        age: { type: 'int' },
                    }
                }
            },
            methodDefinition: {
                type: 'query',
                args: { users: { array: { collection: 'user' } } },
                returns: 'int',
            },
            methodImplementation: async () => 5,
            callArgs: [{ users: [
                { displayName: 'Joe', age: 30 },
                { displayName: 'Bob', age: 40 },
            ] }],
            expectedQuery: {
                query: `query MethodCall($users: [UserInput!]!) { test { testMethod(users: $users) } }`,
                variables: { users: [
                    { displayName: 'Joe', age: 30 },
                    { displayName: 'Bob', age: 40 },
                ] },
                type: 'query',
            }
        },
        'should be able to execute mutations': {
            collections: {},
            methodDefinition: { type: 'mutation', args: { name: 'string' }, returns: 'void' },
            methodImplementation: async () => null,
            otherMethods: {
                dummy: {
                    definition: { type: 'query', args: {}, returns: 'int' },
                    implementation: async () => 5,
                }
            },
            callArgs: [{ name: 'John' }],
            expectedQuery: { query: `mutation { test { testMethod(name: "John") { void } } }`, variables: {}, type: 'mutation' }
        }
    }

    for (const [description, options] of Object.entries(TESTS)) {
        describe(description, () => {
            it('unit test', async () => {
                await runMethodUnitTest(options)
            })
            it('integration test', async () => {
                await runMethodIntegrationTest(options)
            })
        })
    }
})
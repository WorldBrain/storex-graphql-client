import * as expect from 'expect'
import { StorexGraphQLClient } from '.';
import { StorageRegistry, CollectionDefinitionMap } from '@worldbrain/storex';
import { StorageModuleConfig, StorageModuleInterface, registerModuleMapCollections, PublicMethodDefinitions, PublicMethodDefinition, StorageModuleCollections } from '@worldbrain/storex-pattern-modules';

describe('StorexGraphQLClient', () => {
    async function setupTest(options : { modules : {[name : string] : StorageModuleInterface }, respond : (...args) => Promise<any>}) {
        const storageRegistry = new StorageRegistry()
        registerModuleMapCollections(storageRegistry, options.modules)

        const client = new StorexGraphQLClient({ endpoint: null, fetch: true as any, modules: options.modules, storageRegistry })
        const queries = []
        client.executeRequest = async (...args) => {
            queries.push(args)
            return options.respond(args)
        }
        return { client, queries }
    }

    async function runTest(options : {
        collections : StorageModuleCollections,
        methodDefinition : PublicMethodDefinition,
        methodImplementation : (...args) => Promise<any>,
        callArgs : any[]
        expectedQuery : any
    }) {
        class TestModule implements StorageModuleInterface {
            getConfig = () : StorageModuleConfig => ({
                collections: options.collections,
                methods: {
                    testMethod: options.methodDefinition,
                }
            })
        }
        let expectedResponse
        const { client, queries } = await setupTest({
            modules: { test: new TestModule() },
            respond: async (...args) => ({ data: { test: { testMethod: (expectedResponse = await options.methodImplementation(...args)) } } })
        })
        const result = await client.getModules().test.testMethod(...options.callArgs)
        expect(queries).toEqual([[options.expectedQuery]])
        expect(result).toEqual(expectedResponse)
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

    it('should correctly generate read-only queries', async () => {
        await runTest({
            collections: {},
            methodDefinition: { type: 'query', args: { name: 'string' }, returns: 'int' },
            methodImplementation: async () => 5,
            callArgs: [{name: 'John'}],
            expectedQuery: { query: `{ test { testMethod(name: "John") } }`, variables: {}, type: 'query' }
        })
    })

    it('should correctly generate read-only queries with positional args', async () => {
        await runTest({
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
            expectedQuery: { query: `{ test { testMethod(first: "foo", second: "bar", third: "eggs") } }`, variables: {}, type: 'query' }
        })
    })

    it('should correctly select a collection return value', async () => {
        await runTest({
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
            methodImplementation: async () => ({ displayName: 'Joe', age: 30 }),
            callArgs: [],
            expectedQuery: { query: `{ test { testMethod { displayName, age, id } } }`, variables: {}, type: 'query' }
        })
    })

    it('should correctly select a collection array return value', async () => {
        await runTest({
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
                { displayName: 'Joe', age: 30 },
                { displayName: 'Bob', age: 40 },
            ],
            callArgs: [],
            expectedQuery: { query: `{ test { testMethod { displayName, age, id } } }`, variables: {}, type: 'query' }
        })
    })

    it('should correctly handle a scalar array return value', async () => {
        await runTest({
            collections: {},
            methodDefinition: { type: 'query', args: { name: 'string' }, returns: { array: 'int' } },
            methodImplementation: async () => [5, 7, 3],
            callArgs: [{name: 'John'}],
            expectedQuery: { query: `{ test { testMethod(name: "John") } }`, variables: {}, type: 'query' }
        })
    })

    it('should correctly handle void return values', async () => {
        await runTest({
            collections: {},
            methodDefinition: { type: 'query', args: { name: 'string' }, returns: 'void' },
            methodImplementation: async () => null,
            callArgs: [{ name: 'John' }],
            expectedQuery: { query: `{ test { testMethod(name: "John") { void } } }`, variables: {}, type: 'query' }
        })
    })

    it('should be able to pass collections as arguments', async () => {
        await runTest({
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
                returns: 'string',
            },
            methodImplementation: async () => 5,
            callArgs: [{ user: { displayName: 'Joe', age: 30 } }],
            expectedQuery: {
                query: `{ test { testMethod(user: $user) } }`,
                variables: { user: { displayName: 'Joe', age: 30 } },
                type: 'query',
            }
        })
    })

    it('should be able to pass collection arrays as arguments', async () => {
        await runTest({
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
                returns: 'string',
            },
            methodImplementation: async () => 5,
            callArgs: [{ users: [
                { displayName: 'Joe', age: 30 },
                { displayName: 'Bob', age: 40 },
            ] }],
            expectedQuery: {
                query: `{ test { testMethod(users: $users) } }`,
                variables: { users: [
                    { displayName: 'Joe', age: 30 },
                    { displayName: 'Bob', age: 40 },
                ] },
                type: 'query',
            }
        })
    })

    it('should be able to execute mutations', async () => {
        await runTest({
            collections: {},
            methodDefinition: { type: 'mutation', args: { name: 'string' }, returns: 'void' },
            methodImplementation: async () => null,
            callArgs: [{ name: 'John' }],
            expectedQuery: { query: `mutation { test { testMethod(name: "John") { void } } }`, variables: {}, type: 'mutation' }
        })
    })
})
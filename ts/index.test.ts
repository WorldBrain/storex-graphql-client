import * as expect from 'expect'
import { StorexGraphQLClient } from '.';
import { StorageRegistry } from '@worldbrain/storex';
import { StorageModuleConfig, StorageModuleInterface, registerModuleMapCollections } from '@worldbrain/storex-pattern-modules';

describe('StorexGraphQLClient', () => {
    async function setupTest(options : { modules : {[name : string] : StorageModuleInterface }, respond : (...args) => Promise<any>}) {
        const storageRegistry = new StorageRegistry()
        registerModuleMapCollections(storageRegistry, options.modules)

        const client = new StorexGraphQLClient({ endpoint: null, fetch: true as any, modules: options.modules, storageRegistry })
        const queries = []
        client.executeQuery = async (...args) => {
            queries.push(args)
            return options.respond(args)
        }
        return { client, queries }
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
        const result = await client.executeQuery({query: '{ hello }'})
        expect(fetches).toEqual([
            [endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
                body: '{"query":"{ hello }"}'
            }]
        ])
        expect(result).toEqual(fakeResponse)
    })

    it('should correctly generate read-only queries', async () => {
        class TestModule implements StorageModuleInterface {
            getConfig = () : StorageModuleConfig => ({
                collections: { },
                methods: {
                    testMethod: { type: 'query', args: { name: 'string' }, returns: 'int' },
                }
            })
        }
        const { client, queries } = await setupTest({
            modules: { test: new TestModule() },
            respond: async () => ({ data: 5 })
        })
        const result = await client.getModules().test.testMethod({name: 'John'})
        expect(queries).toEqual([[{ query: `query { test { testMethod(name: "John") } }` }]])
        expect(result).toEqual(5)
    })

    it('should correctly generate read-only queries with positional args', async () => {
        class TestModule implements StorageModuleInterface {
            getConfig = () : StorageModuleConfig => ({
                collections: { },
                methods: {
                    testMethod: {
                        type: 'query',
                        args: {
                            first: { type: 'string', positional: true },
                            second: { type: 'string', positional: true },
                            third: { type: 'string' },
                        },
                        returns: 'int',
                    },
                }
            })
        }
        const { client, queries } = await setupTest({
            modules: { test: new TestModule() },
            respond: async () => ({ data: 5 })
        })
        const result = await client.getModules().test.testMethod('foo', 'bar', { third: 'eggs' })
        expect(queries).toEqual([[{ query: `query { test { testMethod(first: "foo", second: "bar", third: "eggs") } }` }]])
        expect(result).toEqual(5)
    })

    it('should correctly select a collection return value', async () => {
        class TestModule implements StorageModuleInterface {
            getConfig = () : StorageModuleConfig => ({
                collections: {
                    user: {
                        version: new Date(),
                        fields: {
                            displayName: { type: 'string' },
                            age: { type: 'int' },
                        }
                    }
                },
                methods: {
                    testMethod: {
                        type: 'query',
                        args: {},
                        returns: { collection: 'user' },
                    },
                }
            })
        }
        const { client, queries } = await setupTest({
            modules: { test: new TestModule() },
            respond: async () => ({ data: { displayName: 'Joe', age: 30 } })
        })
        const result = await client.getModules().test.testMethod()
        expect(queries).toEqual([[{ query: `query { test { testMethod { displayName, age, id } } }` }]])
        expect(result).toEqual({ displayName: 'Joe', age: 30 })
    })

    it('should correctly select a collection array return value', async () => {
        class TestModule implements StorageModuleInterface {
            getConfig = () : StorageModuleConfig => ({
                collections: {
                    user: {
                        version: new Date(),
                        fields: {
                            displayName: { type: 'string' },
                            age: { type: 'int' },
                        }
                    }
                },
                methods: {
                    testMethod: {
                        type: 'query',
                        args: {},
                        returns: { array: { collection: 'user' } },
                    },
                }
            })
        }
        const { client, queries } = await setupTest({
            modules: { test: new TestModule() },
            respond: async () => ({ data: [
                { displayName: 'Joe', age: 30 },
                { displayName: 'Bob', age: 40 },
            ] })
        })
        const result = await client.getModules().test.testMethod()
        expect(queries).toEqual([[{ query: `query { test { testMethod { displayName, age, id } } }` }]])
        expect(result).toEqual([
            { displayName: 'Joe', age: 30 },
            { displayName: 'Bob', age: 40 },
        ])
    })

    it('should correctly handle a scalar array return value')

    it('should be able to pass collections as arguments')

    it('should be able to consume methods returning void')
})
import * as expect from 'expect'
import { StorexGraphQLClient } from '.';
import { StorageModule, StorageModuleConfig, StorageModuleInterface } from '@worldbrain/storex-pattern-modules';

describe('StorexGraphQLClient', () => {
    async function setupTest(options : { modules : {[name : string] : StorageModuleInterface }, respond : (...args) => Promise<any>}) {
        const client = new StorexGraphQLClient({ endpoint: null, fetch: true as any, modules: options.modules })
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
        const client = new StorexGraphQLClient({ endpoint: endpoint, fetch: fetch as any, modules: null })
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
                    byName: { type: 'query', args: { name: 'string' }, returns: 'int' },
                }
            })
        }
        const { client, queries } = await setupTest({
            modules: { test: new TestModule() },
            respond: async () => ({ data: { hello: 'world' } })
        })
        const result = await client.getModules().test.byName({name: 'John'})
        expect(queries).toEqual([[{ query: `query { test { byName(name: "John") } }` }]])
        expect(result).toEqual({ hello: 'world' })
    })

    it('should correctly generate read-only queries with positional args', async () => {
        class TestModule implements StorageModuleInterface {
            getConfig = () : StorageModuleConfig => ({
                collections: { },
                methods: {
                    positionalTest: {
                        type: 'query',
                        args: {
                            first: { type: 'string', positional: true },
                            second: { type: 'string', positional: true },
                            third: { type: 'string' },
                        },
                        returns: { array: 'string' },
                    },
                }
            })
        }
        const { client, queries } = await setupTest({
            modules: { test: new TestModule() },
            respond: async () => ({ data: { hello: 'world' } })
        })
        const result = await client.getModules().test.positionalTest('foo', 'bar', { third: 'eggs' })
        expect(queries).toEqual([[{ query: `query { test { positionalTest(first: "foo", second: "bar", third: "eggs") } }` }]])
        expect(result).toEqual({ hello: 'world' })
    })
})
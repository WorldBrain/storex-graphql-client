import * as graphqlModule from 'graphql'
import express from 'express'
import * as bodyParser from 'body-parser'
import superTest from 'supertest'
import { ApolloServer } from 'apollo-server-express'
import { StorageRegistry } from '@worldbrain/storex';
import { createStorexGraphQLSchema } from '@worldbrain/storex-graphql-schema/lib/modules'
import { StorexGraphQLClient } from '.';
import { registerModuleMapCollections, StorageModuleInterface } from '../../storex-pattern-modules/lib';

export function setupTestGraphQLStorexClient(options : {
    clientModules : {[name : string] : StorageModuleInterface},
    serverModules : {[name : string] : StorageModuleInterface},
    storageRegistry : StorageRegistry,
    graphql : typeof graphqlModule,
    autoPkType : 'int' | 'string'
    respond? : Function,
}) {
    const schema = createStorexGraphQLSchema(options.serverModules, options) as any
    const app = express()
    const server = new ApolloServer({ schema })
    app.use(bodyParser.json())
    server.applyMiddleware({ app, path: '/graphql' })

    const storageRegistry = new StorageRegistry()
    registerModuleMapCollections(storageRegistry, options.clientModules)

    const fetch = async (url, options) => {
        try {
            const response = await superTest(app).post('/graphql')
                .set(options.headers)
                .send(options.body)
            return { json: async () => {
                return response.body
            } }
        } catch (e) {
            if (e.response && e.response.body.errors) {
                return { json: async () => e.response.body }
            }
            throw e
        }
    }

    const client = new StorexGraphQLClient({ endpoint: null, fetch: fetch as any, modules: options.clientModules, storageRegistry })
    const queries = []
    if (options.respond) {
        client.executeRequest = async (...args) => {
            queries.push(args)
            return options.respond(args)
        }
    }
    return { client, queries }
}
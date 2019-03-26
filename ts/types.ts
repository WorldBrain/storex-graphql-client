export type StorexGraphQLClientLogEvent =
    {type : 'preparing-request', module : string, method : string, args : any[]} |
    {type : 'request-prepared', query : any, variables : any, body : any} |
    {type : 'response-received', parsedBody : any} |
    {type : 'call-processed', module : string, method : string, args : any[], returnValue : any}

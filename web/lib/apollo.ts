import { ApolloClient, InMemoryCache, HttpLink, split } from '@apollo/client';
import { GraphQLWsLink } from '@apollo/client/link/subscriptions';
import { getMainDefinition } from '@apollo/client/utilities';
import { createClient as createWsClient } from 'graphql-ws';
import { setContext } from '@apollo/client/link/context';
import { nhost } from './nhost';

const httpLink = new HttpLink({ uri: nhost.graphql.getUrl() });

const authLink = setContext(async (_, { headers }) => {
  const token = nhost.auth.getAccessToken();
  return { headers: { ...headers, authorization: token ? `Bearer ${token}` : '' } };
});

const wsLink =
  typeof window !== 'undefined'
    ? new GraphQLWsLink(
        createWsClient({
          url: nhost.graphql.getUrl().replace(/^http/, 'ws'),
          connectionParams: async () => {
            const token = nhost.auth.getAccessToken();
            return { headers: { authorization: token ? `Bearer ${token}` : '' } };
          },
        })
      )
    : null;

const splitLink =
  typeof window !== 'undefined' && wsLink
    ? split(
        ({ query }) => {
          const def = getMainDefinition(query);
          return def.kind === 'OperationDefinition' && def.operation === 'subscription';
        },
        wsLink,
        authLink.concat(httpLink)
      )
    : authLink.concat(httpLink);

export const apolloClient = new ApolloClient({
  link: splitLink,
  cache: new InMemoryCache(),
});

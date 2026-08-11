'use client';
import { NhostProvider } from '@nhost/react';
import { ApolloProvider } from '@apollo/client';
import { nhost } from '../lib/nhost';
import { apolloClient } from '../lib/apollo';
import './globals.css';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <NhostProvider nhost={nhost}>
          <ApolloProvider client={apolloClient}>{children}</ApolloProvider>
        </NhostProvider>
      </body>
    </html>
  );
}

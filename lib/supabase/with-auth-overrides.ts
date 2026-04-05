type AuthOverrideName = 'getUser' | 'getSession' | 'signOut';

type AuthOverrideMap = Partial<Record<AuthOverrideName, unknown>>;

interface ClientWithAuth {
  auth: object;
}

export function withAuthOverrides<TClient extends ClientWithAuth>(
  client: TClient,
  overrides: AuthOverrideMap
): TClient {
  const authProxy = new Proxy(client.auth, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && prop in overrides) {
        return overrides[prop as AuthOverrideName];
      }

      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === 'auth') {
        return authProxy;
      }

      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

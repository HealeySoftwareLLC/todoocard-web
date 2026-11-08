# Exposing with a Cloudflare Tunnel

Web Bluetooth only works on secure origins, so the app must be reached over
https. A Cloudflare Tunnel gives a public https hostname without opening ports.

1. Create a tunnel in Cloudflare Zero Trust (Networks → Tunnels) and copy the token.
2. Run `cloudflared` in the cluster, for example:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cloudflared
  namespace: todoocard-web
spec:
  replicas: 1
  selector: { matchLabels: { app: cloudflared } }
  template:
    metadata: { labels: { app: cloudflared } }
    spec:
      containers:
        - name: cloudflared
          image: cloudflare/cloudflared:latest
          args: ["tunnel", "--no-autoupdate", "run"]
          env:
            - name: TUNNEL_TOKEN
              valueFrom: { secretKeyRef: { name: cloudflared, key: token } }
```

3. In the tunnel's *Public Hostname* settings, map `cards.example.com` to
   `http://todoocard-web.todoocard-web.svc.cluster.local:80`.
4. Consider enabling Cloudflare Access (an identity policy) on the hostname, or set
   `APP_ACCESS_TOKEN` on the deployment so only people with the token can use the API.

The browser talks Bluetooth locally; the server only serves the page and proxies
image search / generation and image downloads.

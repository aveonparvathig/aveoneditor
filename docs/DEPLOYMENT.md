# Deploying Aveon Editor for free

| Part | Host | Cost |
|---|---|---|
| Demo site (`apps/demo`) | Cloudflare Pages | Free, unlimited bandwidth |
| Collaboration server (`packages/collab-server`) | Oracle Cloud Always Free VM | Free, always on |
| HTTPS name for the server | DuckDNS (or your own domain) | Free |

Deploy the server first, because the demo site is built with its address.

## 1. Push the project to GitHub

Both hosts deploy from a Git repository.

```bash
git remote add origin https://github.com/<you>/aveon-editor.git
git push -u origin master
```

## 2. Collaboration server on Oracle Cloud

1. **Create an account** at <https://www.oracle.com/cloud/free/>. A card is needed to verify identity; Always Free resources are not charged. Upgrading the account to *Pay As You Go* keeps it free within the limits and stops Oracle reclaiming idle Always Free VMs.
2. **Create a VM**: *Compute → Instances → Create instance*.
   - Image: **Ubuntu 24.04**
   - Shape: **VM.Standard.A1.Flex** (Ampere ARM), 4 OCPUs, 24 GB memory — all inside the free allowance.
   - Add your SSH public key, then create. If you see "out of capacity", try another availability domain or try again later.
3. **Open ports 80 and 443**: open the instance's subnet → *Security Lists → Default* → *Add Ingress Rules*, source `0.0.0.0/0`, TCP, destination ports `80,443`. Do not open 1234; the server is reached through Caddy only.
4. **Get a free domain name**: sign in at <https://www.duckdns.org>, add a subdomain (e.g. `aveon-collab`) and set it to the VM's public IP.
5. **Run the setup script** on the VM:

   ```bash
   ssh ubuntu@<vm-public-ip>
   curl -fsSLO https://raw.githubusercontent.com/<you>/aveon-editor/master/deploy/oracle/setup.sh
   sudo bash setup.sh aveon-collab.duckdns.org https://github.com/<you>/aveon-editor.git
   ```

   It installs Node.js 22 and Caddy, opens the VM firewall, starts the server as the `aveon-collab` systemd service (one process per CPU core, documents saved in `/var/lib/aveon-collab`) and gets an HTTPS certificate. The server is then at `wss://aveon-collab.duckdns.org`.

   For a private repository, clone it on the VM yourself into `/opt/aveon` first; the script then just pulls.

**Updating** after you push changes: run the same `sudo bash /opt/aveon/deploy/oracle/setup.sh <domain> <repo>` again.

**Useful commands**

```bash
journalctl -u aveon-collab -f        # server logs
sudo systemctl restart aveon-collab  # restart (open documents are saved first)
sudo tar czf backup.tgz /var/lib/aveon-collab   # back up documents
```

## 3. Demo site on Cloudflare Pages

1. Sign in at <https://dash.cloudflare.com> → *Workers & Pages → Create → Pages → Connect to Git*, and pick the repository.
2. Build settings:

   | Setting | Value |
   |---|---|
   | Framework preset | None |
   | Build command | `npm run build:demo` |
   | Build output directory | `apps/demo/dist` |
   | Environment variable | `VITE_COLLAB_URL` = `wss://aveon-collab.duckdns.org` |

   Node 22 is picked up from `.nvmrc`.
3. Save and deploy. The site is at `https://<project>.pages.dev`, with `/integration.html` and `/collaboration.html`. Every push to `master` redeploys it.

The live demo runs this way at <https://aveoneditor.ceo-02c.workers.dev/>.

If Cloudflare created a **Worker** instead (the newer *Create app* flow, whose deploy command is `npx wrangler deploy`), set the build command to `npm run build:demo`. `wrangler.jsonc` tells it to serve `apps/demo/dist`. Its `name` must match the Worker's name in the dashboard.

Without `VITE_COLLAB_URL` the collaboration page connects to `ws://<page host>:1234`, which is what local development uses.

### Or on Vercel

The demo site can go on Vercel instead. `vercel.json` already holds the build settings.

1. Sign in at <https://vercel.com> → *Add New → Project*, and import the repository. Leave the root directory as the repository root.
2. Under *Environment Variables*, add `VITE_COLLAB_URL` = `wss://aveon-collab.duckdns.org`.
3. Deploy. The site is at `https://<project>.vercel.app`, and every push redeploys it. Pushes to other branches get preview addresses.

Or, from the command line: `npx vercel` (preview) and `npx vercel --prod`.

The collaboration server cannot run on Vercel: Vercel functions do not keep WebSocket connections open, and the server needs them. Keep it on the Oracle VM. Vercel's free Hobby plan is for non-commercial use only; a business site needs the Pro plan. Cloudflare Pages has no such limit.

## Using the server from your own app

```js
createEditor(element, {
  collaboration: { url: 'wss://aveon-collab.duckdns.org', documentId: 'quote-42', token: () => getToken() }
});
```

The server accepts anyone who can reach it. Before real users rely on it, pass an `authenticate` function to `createCollaborationServer` (see the README) so only signed-in users can open documents.

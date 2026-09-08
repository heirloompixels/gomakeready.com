# Deploying to GitHub Pages

The site is built and deployed automatically to GitHub Pages using GitHub Actions.

## Setup

1. Push this repository to GitHub.
2. In your repository on GitHub, navigate to **Settings > Pages**.
3. Under **Build and deployment > Source**, select **GitHub Actions** from the dropdown menu.
4. The workflow in `.github/workflows/deploy.yml` will trigger on any push to the `main` branch, build the Zola site, and publish it.

## Custom Domain Configuration

The [static/CNAME](file:///Users/kpc/machinery/ventures/gmr/static/CNAME) file has been configured with `gomakeready.com`. This tells GitHub Pages to route the domain correctly.

### DNS Records

Configure your DNS provider with the following records to map your custom domain:

#### 1. Apex Domain (`gomakeready.com`)
Create **A records** pointing to GitHub Pages IP addresses:
* `185.199.108.153`
* `185.199.109.153`
* `185.199.110.153`
* `185.199.111.153`

(Optional but recommended) Create **AAAA records** for IPv6:
* `2606:50c0:8000::153`
* `2606:50c0:8001::153`
* `2606:50c0:8002::153`
* `2606:50c0:8003::153`

#### 2. Subdomain (`www.gomakeready.com`)
Create a **CNAME record** pointing `www` to your GitHub Pages default domain:
* `www.gomakeready.com` CNAME `<your-github-username>.github.io`

#### 3. Redirect Domains
* `makeready.ink` — Point to the same GitHub Pages IPs or use your domain registrar's redirect tool to HTTP 301 redirect to `https://gomakeready.com`.
* `getmakeready.com` — Point to the same GitHub Pages IPs or use your domain registrar's redirect tool to HTTP 301 redirect to `https://gomakeready.com`.

### HTTPS

Once DNS has propagated, go back to **Settings > Pages** on GitHub and check **Enforce HTTPS** to secure the site with a free Let's Encrypt certificate.

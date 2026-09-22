# Global Deployment Setup Guide

This guide helps you deploy CIMS with:
- **Frontend** on Vercel (globally accessible)
- **Backend** accessible via ngrok (for testing) or a cloud server

---

## Step 1: Install ngrok (For Testing/Local Backend)

```bash
npm install -g ngrok
```

Or download from: https://ngrok.com

---

## Step 2: Start Backend Locally

```bash
cd backend
npm install
npm start
```

Your backend will run on `http://localhost:5000`

---

## Step 3: Expose Backend with ngrok

In a new terminal:

```bash
ngrok http 5000
```

You'll get output like:
```
Session Status                online
Account                       [your-account]
Version                        3.x.x
Region                        us (United States)
Forwarding                    https://abc123d.ngrok.io -> http://localhost:5000
```

**Copy the HTTPS URL** (e.g., `https://abc123d.ngrok.io`)

---

## Step 4: Update Frontend for Vercel

### Option A: Local testing (ngrok)

Edit `frontend/.env`:

```env
REACT_APP_API_URL=https://abc123d.ngrok.io
```

Then test locally:
```bash
cd frontend
npm install
npm start
```

Visit `http://localhost:3000` and it will call your ngrok backend.

### Option B: Deploy to Vercel

1. Go to https://vercel.com and sign in with GitHub
2. Click "New Project"
3. Select your GitHub repo `cims.jpnagar`
4. Configure:
   - **Root Directory**: `frontend`
   - **Build Command**: `npm run build`
   - **Output Directory**: `build`
5. Add environment variable:
   - **Name**: `REACT_APP_API_URL`
   - **Value**: `https://abc123d.ngrok.io` (or your cloud backend URL)
6. Click "Deploy"

Vercel will build and host your frontend globally!

---

## Step 5: Keep ngrok Running (or Use Cloud Backend)

### IF using ngrok for testing:
- Keep the ngrok session running in your terminal
- Every time you restart, you get a new URL
- Update `REACT_APP_API_URL` in Vercel environment variables

### IF using cloud backend (recommended):
- Deploy backend to Render, Railway, Heroku, etc.
- Use that permanent URL for `REACT_APP_API_URL`
- No need to keep your PC running

---

## Step 6: Test Global Access

Once deployed to Vercel:
- Share the Vercel URL with global users
- They can access the frontend globally
- Backend calls go through ngrok (or your cloud host)

---

## Common Issues

### ngrok URL expires
- Free ngrok URLs change every restart
- Solution: Pay for ngrok, or use a permanent cloud backend

### CORS errors
- Ensure your backend has CORS enabled
- Check `backend/server.js` for `cors()` middleware

### Environment variables not updating
- Vercel caches builds
- Update `REACT_APP_API_URL` in Vercel dashboard → Settings → Environment Variables
- Redeploy the project

---

## Production Recommendation

For a real global app:
1. Deploy backend to **Render**, **Railway**, or **DigitalOcean**
2. Get a permanent backend URL
3. Deploy frontend to **Vercel** with that URL
4. Both are now globally accessible and running 24/7

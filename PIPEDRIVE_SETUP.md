# Pipedrive Integration Setup Guide

This guide will help you configure Pipedrive API integration in your Horizon UI Next.js Pro project.

## Prerequisites

1. **Pipedrive Account**: You need an active Pipedrive account
2. **API Access**: API access enabled in your Pipedrive account

## Step 1: Get Your Pipedrive API Credentials

### 1.1 Get API Token
1. Log in to your Pipedrive account
2. Go to **Settings** → **Personal Preferences** → **API**
3. Copy your **API Token**

### 1.2 Get Your Domain
1. Your domain is the subdomain part of your Pipedrive URL
2. If your URL is `https://company.pipedrive.com`, your domain is `company`
3. If your URL is `https://company.pipedrive.com`, your domain is `company`

### 1.3 (Optional) Get OAuth Credentials
If you plan to use OAuth authentication:
1. Go to **Settings** → **Personal Preferences** → **API**
2. Create a new OAuth app
3. Note down **Client ID** and **Client Secret**

## Step 2: Configure Environment Variables

### 2.1 Create Environment File
1. Copy `env.example` to `.env.local`
2. Fill in your actual values:

```bash
# Copy the example file
cp env.example .env.local

# Edit the file with your values
nano .env.local
```

### 2.2 Required Variables
```env
PIPEDRIVE_API_TOKEN=your_actual_api_token_here
PIPEDRIVE_DOMAIN=your_actual_domain_here
```

### 2.3 Optional Variables
```env
PIPEDRIVE_CLIENT_ID=your_oauth_client_id
PIPEDRIVE_CLIENT_SECRET=your_oauth_client_secret
PIPEDRIVE_WEBHOOK_SECRET=your_webhook_secret
```

## Step 3: Verify Configuration

### 3.1 Check Configuration Status
The project includes a utility function to verify your configuration:

```typescript
import { isPipedriveConfigured } from '@/utils/pipedrive';

if (isPipedriveConfigured()) {
  console.log('Pipedrive is properly configured!');
} else {
  console.log('Pipedrive configuration is missing or invalid');
}
```

### 3.2 Test API Connection
```typescript
import { pipedrive } from '@/utils/pipedrive';

// Test the connection by fetching deals
try {
  const deals = await pipedrive.deals.getAll();
  console.log('Connection successful!', deals.data?.length, 'deals found');
} catch (error) {
  console.error('Connection failed:', error);
}
```

## Step 4: Usage Examples

### 4.1 Basic Usage
```typescript
import { pipedrive } from '@/utils/pipedrive';

// Get all deals
const deals = await pipedrive.deals.getAll();

// Create a new deal
const newDeal = await pipedrive.deals.create({
  title: 'New Deal',
  value: 10000,
  currency: 'USD'
});

// Get a specific contact
const contact = await pipedrive.persons.get(123);
```

### 4.2 Error Handling
```typescript
import { pipedrive } from '@/utils/pipedrive';

try {
  const deals = await pipedrive.deals.getAll();
  // Process deals
} catch (error) {
  if (error.status === 401) {
    console.error('Invalid API token');
  } else if (error.status === 429) {
    console.error('Rate limit exceeded');
  } else {
    console.error('API error:', error);
  }
}
```

## Step 5: Security Best Practices

### 5.1 Environment Variables
- ✅ Use `.env.local` for local development
- ✅ Never commit `.env.local` to version control
- ✅ Use environment variables in production

### 5.2 API Token Security
- ✅ Keep your API token secure
- ✅ Rotate tokens regularly
- ✅ Use least privilege principle
- ✅ Monitor API usage

### 5.3 Rate Limiting
- Pipedrive has rate limits (100 requests per 10 seconds)
- Implement proper error handling for rate limit errors
- Consider implementing request queuing for high-volume operations

## Troubleshooting

### Common Issues

#### 1. "API Token Required" Error
- Check that `.env.local` exists
- Verify `PIPEDRIVE_API_TOKEN` is set correctly
- Restart your development server after changing environment variables

#### 2. "Domain Required" Error
- Ensure `PIPEDRIVE_DOMAIN` is set
- Verify the domain format (no `https://` or `.pipedrive.com`)

#### 3. "Unauthorized" Error
- Verify your API token is correct
- Check if your API token has expired
- Ensure your Pipedrive account has API access enabled

#### 4. "Rate Limit Exceeded" Error
- Implement exponential backoff
- Reduce request frequency
- Use bulk operations when possible

## Support

- **Pipedrive API Documentation**: https://developers.pipedrive.com/
- **Pipedrive Support**: https://support.pipedrive.com/
- **Project Issues**: Check the project's GitHub issues

## Next Steps

After completing this setup:
1. Test your API connection
2. Start building Pipedrive integrations
3. Implement proper error handling
4. Add monitoring and logging
5. Consider implementing webhooks for real-time updates

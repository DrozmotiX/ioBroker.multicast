# ioBroker.multicast Adapter

This is an ioBroker adapter for multicast UDP communication that provides an API based on multicast communication protocol to send and receive states to devices with custom firmware.

**Always reference these instructions first and fallback to search or bash commands only when you encounter unexpected information that does not match the info here.**

## Working Effectively

### Bootstrap and Setup
```bash
# Install dependencies - takes ~25 seconds, NEVER CANCEL
npm ci
# Timeout: Set 120+ seconds for npm ci commands
```

### Build and Test Commands
```bash
# Lint the code - takes <1 second, CRITICAL for CI/CD
npm run lint

# Run all tests - takes ~52 seconds total, NEVER CANCEL
npm run test
# This runs both test:js and test:package

# Individual test commands:
npm run test:package    # Package validation tests - takes <1 second
npm run test:unit       # Unit tests (deprecated warnings OK) - takes <1 second
npm run test:integration # Integration tests - takes ~52 seconds, NEVER CANCEL
# Timeout: Set 180+ seconds for integration tests
```

### CRITICAL Timing Information
- **npm ci**: ~25 seconds - Set timeout to 120+ seconds minimum
- **npm run lint**: <1 second
- **npm run test:package**: <1 second  
- **npm run test:integration**: ~52 seconds - Set timeout to 180+ seconds minimum
- **NEVER CANCEL** any build or test command - wait for full completion

### Known Issues with Testing
The project uses deprecated Mocha configuration. If `npm run test:js` fails with "--opts deprecated" error, use:
```bash
# Alternative test command that works:
mocha --require test/mocha.setup.js "{!(node_modules|test)/**/*.test.js,*.test.js,test/**/test!(PackageFiles|Startup).js}"
```

### Security Vulnerabilities
The project has 26 npm security vulnerabilities (mostly in dev dependencies like axios in release tools). These do not block development or runtime functionality. Run `npm audit` for details.

## Validation

### Manual Testing Requirements
**ALWAYS run through these validation scenarios after making changes:**

1. **Adapter Startup Validation**:
   ```bash
   # Integration tests verify the adapter can start successfully
   npm run test:integration
   ```

2. **Configuration Validation**:
   - Verify multicast IP addresses are correctly configured (239.12.255.151:9501 receive, 239.12.255.252:9633 send)
   - Check retry settings and timeout configurations

3. **Admin UI Testing**:
   - Admin interface files located in `/admin/` directory
   - Configuration form in `admin/index_m.html`
   - Verify Material UI components load correctly

### Pre-Commit Requirements
**ALWAYS run these commands before committing or CI will fail:**
```bash
npm run lint     # ESLint validation - must pass
npm run test     # All tests must pass
```

### Multicast Functionality Testing
The adapter handles UDP multicast communication. Key testing scenarios:

#### Basic Functionality Test
```bash
# 1. Start integration tests to verify basic adapter functionality
npm run test:integration
# This verifies the adapter can start, bind to multicast ports, and handle basic operations

# 2. Check multicast socket binding
# The adapter binds to 239.12.255.151:9501 (receive) and sends to 239.12.255.252:9633
# Integration tests verify this works correctly
```

#### Advanced Manual Testing (if needed)
To test actual multicast communication, you would need:
- A device or simulator that sends multicast UDP packets in the expected JSON format
- Network access to multicast groups 239.12.255.x
- The adapter expects JSON messages with Type: "Object", "State", "StateInterval", "Recovery", "Heartbeat", or "Info"

**Note**: The integration tests verify that the adapter starts correctly and binds to the multicast socket, which covers the core functionality validation.

## Repository Structure

### Key Files and Locations
```
/main.js                    # Main adapter logic and multicast handling
/io-package.json           # ioBroker adapter configuration and metadata
/package.json              # Node.js dependencies and npm scripts
/admin/index_m.html        # Admin configuration UI (Material design)
/admin/words.js            # Localization definitions
/lib/tools.js              # Utility functions
/test/                     # Test files and configuration
/.eslintrc.json           # ESLint configuration
/gulpfile.js              # Gulp tasks for localization and releases
```

### Important Configuration
- **Multicast IPs**: Receive on 239.12.255.151:9501, Send to 239.12.255.252:9633
- **Retry Logic**: 5 retries maximum with 500ms intervals
- **Supported Node.js**: 16.x, 18.x, 20.x (as per GitHub Actions)

## Common Tasks

### Localization and Internationalization
```bash
# Update translations (runs multiple gulp tasks) - takes <1 second
npx gulp translateAndUpdateWordsJS

# Default gulp task (updates packages and README) - takes <1 second
npx gulp default

# Individual localization tasks:
npx gulp adminWords2languages      # Convert words.js to language files
npx gulp adminLanguages2words      # Convert language files back to words.js
npx gulp translate                 # Auto-translate missing translations
```

### Release Management
```bash
npm run release    # Automated release script using @alcalzone/release-script
```

### Development Workflow
1. Make code changes
2. Run `npm run lint` to check code style
3. Run `npm run test` to verify functionality
4. Test manually with integration tests
5. Commit changes (CI will run automated tests)

## GitHub Actions CI/CD

The repository uses GitHub Actions with the following workflow:
- **Linting**: Uses `ioBroker/testing-action-check@v1` with Node.js 16.x
- **Testing**: Runs on Node.js 16.x, 18.x, 20.x across Ubuntu, Windows, and macOS
- **Deployment**: Automated npm releases on tagged versions

### CI Requirements
- All lint checks must pass (`npm run lint`)
- All tests must pass on all supported Node.js versions and platforms
- Proper semantic versioning for releases

### Troubleshooting

### Common Issues
1. **Mocha opts deprecated warning**: Use alternative test command shown above
2. **npm vulnerabilities**: 26 vulnerabilities in dev dependencies (release tools) - don't block development
3. **Integration test timeout**: Tests take ~52 seconds - ensure adequate timeouts
4. **Multicast binding issues**: Check firewall settings and UDP port availability
5. **"Cannot find js-controller" error**: Normal when running adapter outside ioBroker environment

### Network Requirements
- UDP multicast support on network interface
- Ports 9501 (receive) and 9633 (send) must be available
- Firewall may need configuration for multicast traffic
- Adapter requires ioBroker environment to run properly

## Advanced Development

### Adapter Architecture
- Uses `@iobroker/adapter-core` framework
- Implements UDP multicast client/server
- Supports device auto-discovery and state management
- Includes retry mechanism and error handling

### Key Dependencies
- `@iobroker/adapter-core`: Core ioBroker adapter functionality
- `random-token`: Token generation for device identification
- `dgram`: Node.js UDP socket implementation

Always validate that adapter starts correctly and can handle multicast communication after any core changes.
const { validateMatchData } = require('./index');
const http = require('http');

// --- Helper for HTTP Requests ---
const makeRequest = (options, postData) => {
    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ statusCode: res.statusCode, body: JSON.parse(data) });
                } catch (e) {
                    resolve({ statusCode: res.statusCode, body: data });
                }
            });
        });
        req.on('error', reject);
        if (postData) req.write(JSON.stringify(postData));
        req.end();
    });
};

const runTests = async () => {
    console.log('🧪 Lancement des tests...\n');

    // =========================================================
    // 1. TESTS UNITAIRES (3 Tests) - Validation JSON
    // =========================================================
    console.log('--- 1. TESTS UNITAIRES (Validation Data) ---');

    // Test 1.1: Valid Data
    const validData = { summoner_name: 'Faker', champion: 'Ahri', kda: '10/0/5', win: true };
    const res1 = validateMatchData(validData);
    if (res1.valid) console.log('✅ Test 1.1 Passed: Valid Data accepted');
    else console.error('❌ Test 1.1 Failed:', res1.errors);

    // Test 1.2: Invalid KDA Format
    const invalidKDA = { summoner_name: 'Faker', champion: 'Ahri', kda: '10-0-5', win: true };
    const res2 = validateMatchData(invalidKDA);
    if (!res2.valid && res2.errors.includes('Invalid KDA format (e.g. 10/2/5)'))
        console.log('✅ Test 1.2 Passed: Invalid KDA rejected');
    else console.error('❌ Test 1.2 Failed: Invalid KDA should be rejected');

    // Test 1.3: Missing Champion
    const missingChamp = { summoner_name: 'Faker', kda: '10/0/5', win: true };
    const res3 = validateMatchData(missingChamp);
    if (!res3.valid && res3.errors.includes('Invalid champion'))
        console.log('✅ Test 1.3 Passed: Missing Champion rejected');
    else console.error('❌ Test 1.3 Failed: Missing Champion should be rejected');

    console.log('\n');

    // =========================================================
    // 2. TESTS D\'INTÉGRATION (2 Tests) - API -> DB Primary
    // =========================================================
    console.log('--- 2. TESTS D\'INTÉGRATION (API -> Primary) ---');

    // Test 2.1: Write Test (Diagnostic Endpoint)
    try {
        const resWrite = await makeRequest({
            hostname: 'localhost', port: 3000, path: '/db/write-test', method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        if (resWrite.statusCode === 200 && resWrite.body.role === 'WRITE' && resWrite.body.host_used === 'postgres-primary') {
            console.log('✅ Test 2.1 Passed: Inserted into Primary successfully');
        } else {
            console.error('❌ Test 2.1 Failed:', resWrite.body);
        }
    } catch (err) { console.error('❌ Test 2.1 Failed (Network):', err.message); }

    // Test 2.2: Business Logic Write (API/Match)
    try {
        const resMatch = await makeRequest({
            hostname: 'localhost', port: 3000, path: '/api/match', method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, { summoner_name: 'TestIntegration', champion: 'Teemo', kda: '0/10/0', win: false });

        if (resMatch.statusCode === 201 && resMatch.body.summoner_name === 'TestIntegration') {
            console.log('✅ Test 2.2 Passed: Business Match inserted successfully');
        } else {
            console.error('❌ Test 2.2 Failed:', resMatch.body);
        }
    } catch (err) { console.error('❌ Test 2.2 Failed (Network):', err.message); }

    console.log('\n');

    // =========================================================
    // 3. TEST DE LECTURE REPLICA (1 Test)
    // =========================================================
    console.log('--- 3. TEST DE LECTURE REPLICA ---');

    try {
        const resRead = await makeRequest({
            hostname: 'localhost', port: 3000, path: '/db/read-test', method: 'GET'
        });

        if (resRead.statusCode === 200 && resRead.body.role === 'READ') {
            const host = resRead.body.host_used;
            if (host === 'postgres-replica-1' || host === 'postgres-replica-2') {
                console.log(`✅ Test 3.1 Passed: Read performed on Replica (${host})`);
            } else {
                console.error(`❌ Test 3.1 Failed: Read performed on ${host} (Expected Replica)`);
            }
        } else {
            console.error('❌ Test 3.1 Failed:', resRead.body);
        }
    } catch (err) { console.error('❌ Test 3.1 Failed (Network):', err.message); }

    // Stop the process
    process.exit(0);
};

runTests();

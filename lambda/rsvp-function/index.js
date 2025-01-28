const { DynamoDBClient, PutItemCommand } = require('@aws-sdk/client-dynamodb');
const { marshall } = require('@aws-sdk/util-dynamodb');

const dynamoDB = new DynamoDBClient({ region: 'us-east-1' });

const VALID_AGE_GROUPS = [
    'Adult (18+)',
    'Teen (13-17)',
    'Kid (6-12)',
    'Little (2-5)',
    'Baby (1 and under)'
];

exports.handler = async (event) => {
    console.log('Environment variables:', {
        tableName: process.env.RSVP_TABLE_NAME,
        hasTableName: !!process.env.RSVP_TABLE_NAME
    });
    
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key',
        'Access-Control-Allow-Methods': 'OPTIONS,POST'
    };

    try {
        const rsvpData = JSON.parse(event.body);
        console.log('Parsed RSVP data:', JSON.stringify(rsvpData, null, 2));
        
        // Log the actual validation checks
        console.log('Validation checks:', {
            mainContactValid: !!(rsvpData.mainContact?.email && rsvpData.mainContact?.name),
            isGuestsArray: Array.isArray(rsvpData.guests),
            guestCount: rsvpData.totalGuests,
            actualGuestCount: rsvpData.guests?.length,
            guestsValid: rsvpData.guests?.every(guest => {
                const isValid = guest.name && guest.age && VALID_AGE_GROUPS.includes(guest.age);
                console.log('Guest check:', {
                    name: guest.name,
                    age: guest.age,
                    isNameValid: !!guest.name,
                    isAgeValid: VALID_AGE_GROUPS.includes(guest.age)
                });
                return isValid;
            })
        });

        // Individual guest validation
        if (Array.isArray(rsvpData.guests)) {
            rsvpData.guests.forEach((guest, index) => {
                console.log(`Guest ${index} validation:`, {
                    name: guest.name,
                    age: guest.age,
                    isNameValid: !!guest.name,
                    isAgeValid: VALID_AGE_GROUPS.includes(guest.age),
                    ageInList: VALID_AGE_GROUPS.includes(guest.age),
                    exactMatch: VALID_AGE_GROUPS.find(age => age === guest.age)
                });
            });
        }

        // Check guest count match
        if (rsvpData.totalGuests !== rsvpData.guests.length) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({
                    message: 'Guest count mismatch',
                    detail: {
                        expected: rsvpData.totalGuests,
                        actual: rsvpData.guests.length
                    }
                })
            };
        }

        // Check guest data validity
        const invalidGuests = rsvpData.guests.filter(guest => 
            !guest.name || !guest.age || !VALID_AGE_GROUPS.includes(guest.age)
        );

        if (invalidGuests.length > 0) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({
                    message: 'Invalid guest data',
                    detail: {
                        invalidGuests,
                        VALID_AGE_GROUPS
                    }
                })
            };
        }

        // Proceed with saving if everything is valid
        const submissionDate = new Date().toISOString();
        const item = {
            email: rsvpData.mainContact.email.trim().toLowerCase(),
            submissionDate,
            name: rsvpData.mainContact.name.trim(),
            totalGuests: rsvpData.guests.length,
            guests: rsvpData.guests.map(guest => ({
                name: guest.name.trim(),
                age: guest.age
            }))
        };

        const command = new PutItemCommand({
            TableName: process.env.RSVP_TABLE_NAME,
            Item: marshall(item)
        });

        await dynamoDB.send(command);

        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
                message: 'RSVP recorded successfully',
                confirmationId: submissionDate
            })
        };

    } catch (error) {
        console.error('Error details:', {
            error: error.message,
            stack: error.stack,
            type: error.constructor.name
        });
        
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                message: 'Error processing RSVP',
                error: error.message,
                detail: error.stack
            })
        };
    }
};
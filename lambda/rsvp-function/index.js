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
    console.log('Received event:', JSON.stringify(event, null, 2));
    
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key',
        'Access-Control-Allow-Methods': 'OPTIONS,POST'
    };

    try {
        if (!event.body) {
            console.log('Missing request body');
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ 
                    message: 'Missing request body',
                    detail: 'Request body is required'
                })
            };
        }

        const rsvpData = JSON.parse(event.body);
        console.log('Parsed RSVP data:', JSON.stringify(rsvpData, null, 2));

        // Log the main contact validation
        const mainContactCheck = {
            hasEmail: !!rsvpData.mainContact?.email,
            hasName: !!rsvpData.mainContact?.name,
            email: rsvpData.mainContact?.email,
            name: rsvpData.mainContact?.name
        };
        console.log('Main contact validation:', mainContactCheck);

        if (!mainContactCheck.hasEmail || !mainContactCheck.hasName) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ 
                    message: 'Missing main contact information',
                    detail: mainContactCheck
                })
            };
        }

        // Log the guests array check
        console.log('Guests array type:', typeof rsvpData.guests);
        console.log('Is array?', Array.isArray(rsvpData.guests));

        if (!Array.isArray(rsvpData.guests)) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ 
                    message: 'Guests must be an array',
                    detail: `Received: ${typeof rsvpData.guests}`
                })
            };
        }

        // Log valid age groups for reference
        console.log('Valid age groups:', VALID_AGE_GROUPS);

        // Detailed guest validation with logging
        const guestValidations = rsvpData.guests.map((guest, index) => {
            const validation = {
                index,
                originalGuest: guest,
                hasName: !!guest.name,
                hasAge: !!guest.age,
                isAgeValid: VALID_AGE_GROUPS.includes(guest.age),
                providedAge: guest.age
            };
            console.log(`Guest ${index} validation:`, validation);
            return validation;
        });

        const invalidGuests = guestValidations.filter(v => 
            !v.hasName || !v.hasAge || !v.isAgeValid
        );

        console.log('Invalid guests:', invalidGuests);

        if (invalidGuests.length > 0) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ 
                    message: 'Invalid guest data',
                    detail: {
                        invalidGuests,
                        validAgeGroups: VALID_AGE_GROUPS
                    }
                })
            };
        }

        // Log guest count validation
        console.log('Guest count validation:', {
            expectedTotal: rsvpData.totalGuests,
            actualCount: rsvpData.guests.length
        });

        if (rsvpData.totalGuests !== rsvpData.guests.length) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ 
                    message: 'Guest count mismatch',
                    detail: {
                        expectedCount: rsvpData.totalGuests,
                        actualCount: rsvpData.guests.length
                    }
                })
            };
        }

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
        
        console.log('Saving item:', JSON.stringify(item, null, 2));
        
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
        console.error('Error processing RSVP:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ 
                message: 'Error processing RSVP',
                error: error.message,
                stack: error.stack
            })
        };
    }
};
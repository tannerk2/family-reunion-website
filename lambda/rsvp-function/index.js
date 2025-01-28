const { DynamoDBClient, PutItemCommand } = require('@aws-sdk/client-dynamodb');
const { marshall } = require('@aws-sdk/util-dynamodb');

const dynamoDB = new DynamoDBClient({ region: 'us-east-1' });

// Changed variable name to match usage in validation
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

    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: ''
        };
    }

    try {
        if (!event.body) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'Missing request body' })
            };
        }

        const rsvpData = JSON.parse(event.body);
        console.log('Parsed request data:', JSON.stringify(rsvpData, null, 2));

        // Validate main contact
        if (!rsvpData.mainContact?.email || !rsvpData.mainContact?.name) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'Missing main contact information' })
            };
        }

        // Validate guests array
        if (!Array.isArray(rsvpData.guests)) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'Guests must be an array' })
            };
        }

        // Add detailed validation logging
        console.log('Valid age groups:', VALID_AGE_GROUPS);
        
        // Validate each guest with detailed logging
        const isValidGuests = rsvpData.guests.every(guest => {
            console.log('Validating guest:', guest);
            const isValid = guest.name && 
                          typeof guest.age === 'string' && 
                          VALID_AGE_GROUPS.includes(guest.age);
            
            if (!isValid) {
                console.log('Guest validation failed:', {
                    hasName: !!guest.name,
                    ageIsString: typeof guest.age === 'string',
                    ageIsValid: VALID_AGE_GROUPS.includes(guest.age)
                });
            }
            
            return isValid;
        });

        if (!isValidGuests) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'Invalid guest data' })
            };
        }

        const submissionDate = new Date().toISOString();
        
        const item = {
            email: rsvpData.mainContact.email,
            submissionDate: submissionDate,
            name: rsvpData.mainContact.name,
            totalGuests: rsvpData.guests.length,
            guests: rsvpData.guests
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
                error: error.message
            })
        };
    }
};
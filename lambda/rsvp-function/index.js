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
                    detail: 'The request body is empty or undefined'
                })
            };
        }

        const rsvpData = JSON.parse(event.body);
        console.log('Parsed RSVP data:', JSON.stringify(rsvpData, null, 2));

        // Validate main contact with detailed logging
        const mainContactValidation = {
            hasEmail: !!rsvpData.mainContact?.email,
            hasName: !!rsvpData.mainContact?.name,
            isValid: !!(rsvpData.mainContact?.email && rsvpData.mainContact?.name)
        };
        
        console.log('Main contact validation:', mainContactValidation);

        if (!mainContactValidation.isValid) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ 
                    message: 'Missing main contact information',
                    detail: mainContactValidation
                })
            };
        }

        // Validate guests array
        if (!Array.isArray(rsvpData.guests)) {
            console.log('Invalid guests format:', typeof rsvpData.guests);
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ 
                    message: 'Guests must be an array',
                    detail: `Received type: ${typeof rsvpData.guests}`
                })
            };
        }

        // Detailed guest validation
        const guestValidations = rsvpData.guests.map((guest, index) => {
            const validation = {
                index,
                guest,
                hasName: !!guest.name,
                hasAge: !!guest.age,
                ageIsString: typeof guest.age === 'string',
                ageIsValid: VALID_AGE_GROUPS.includes(guest.age),
                isValid: false
            };
            
            validation.isValid = validation.hasName && 
                               validation.hasAge && 
                               validation.ageIsString && 
                               validation.ageIsValid;
            
            return validation;
        });

        console.log('Guest validations:', JSON.stringify(guestValidations, null, 2));

        const isValidGuests = guestValidations.every(v => v.isValid);

        if (!isValidGuests) {
            const invalidGuests = guestValidations.filter(v => !v.isValid);
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
                error: error.message,
                stack: error.stack
            })
        };
    }
};
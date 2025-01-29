const { DynamoDBClient, PutItemCommand } = require('@aws-sdk/client-dynamodb');
const { marshall } = require('@aws-sdk/util-dynamodb');

const dynamoDB = new DynamoDBClient({ region: 'us-east-1' });
const VALID_AGE_GROUPS = ['A', 'T', 'K', 'L', 'B'];

exports.handler = async (event) => {
    // Log initial event and environment
    console.log('Environment check:', {
        tableName: process.env.RSVP_TABLE_NAME,
        hasTableName: !!process.env.RSVP_TABLE_NAME,
        nodeEnv: process.env.NODE_ENV,
        allVars: process.env
    });
    
    console.log('Event received:', JSON.stringify(event, null, 2));
    
    const corsHeaders = {
        'Access-Control-Allow-Origin': 'https://wadsworthreunion.com',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key',
        'Access-Control-Allow-Methods': 'OPTIONS,POST'
    };

    try {
        // Parse and log the request body
        const rsvpData = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
        console.log('Parsed RSVP data:', JSON.stringify(rsvpData, null, 2));

        // Log validation details
        console.log('Validation details:', {
            mainContact: {
                hasEmail: !!rsvpData.mainContact?.email,
                hasName: !!rsvpData.mainContact?.name,
                hasAge: !!rsvpData.mainContact?.age,
                hasAttendance: {
                    friday: rsvpData.mainContact?.attendingFriday,
                    saturday: rsvpData.mainContact?.attendingSaturday
                },
                email: rsvpData.mainContact?.email,
                name: rsvpData.mainContact?.name,
                age: rsvpData.mainContact?.age
            },
            guests: {
                isArray: Array.isArray(rsvpData.guests),
                length: rsvpData.guests?.length,
                expectedTotal: rsvpData.totalGuests,
                ages: rsvpData.guests?.map(g => g.age),
                validAgeGroups: VALID_AGE_GROUPS
            }
        });

        // Main contact validation
        if (!rsvpData.mainContact?.email || !rsvpData.mainContact?.name || !rsvpData.mainContact?.age || 
            (!rsvpData.mainContact?.attendingFriday && !rsvpData.mainContact?.attendingSaturday)) {
            console.log('Main contact validation failed');
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({
                    message: 'Invalid main contact data',
                    detail: {
                        mainContact: rsvpData.mainContact,
                        validation: {
                            hasEmail: !!rsvpData.mainContact?.email,
                            hasName: !!rsvpData.mainContact?.name,
                            hasAge: !!rsvpData.mainContact?.age,
                            ageValid: VALID_AGE_GROUPS.includes(rsvpData.mainContact?.age),
                            hasAttendanceDays: rsvpData.mainContact?.attendingFriday || rsvpData.mainContact?.attendingSaturday
                        }
                    }
                })
            };
        }

        // Validate main contact age group
        if (!VALID_AGE_GROUPS.includes(rsvpData.mainContact.age)) {
            console.log('Main contact age validation failed');
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({
                    message: 'Invalid age group for main contact',
                    detail: {
                        providedAge: rsvpData.mainContact.age,
                        validAgeGroups: VALID_AGE_GROUPS
                    }
                })
            };
        }

        // Guest array validation
        if (!Array.isArray(rsvpData.guests)) {
            console.log('Guest array validation failed');
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({
                    message: 'Guests must be an array',
                    detail: { 
                        receivedType: typeof rsvpData.guests,
                        guests: rsvpData.guests 
                    }
                })
            };
        }

        // Guest count validation
        if (rsvpData.totalGuests !== rsvpData.guests.length) {
            console.log('Guest count validation failed');
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

        // Individual guest validation
        console.log('Starting individual guest validation');
        const guestValidation = rsvpData.guests.map((guest, index) => {
            const validation = {
                index,
                name: guest.name,
                age: guest.age,
                nameValid: !!guest.name,
                ageValid: VALID_AGE_GROUPS.includes(guest.age),
            };
            console.log(`Guest ${index} validation:`, validation);
            return validation;
        });

        const invalidGuests = guestValidation.filter(g => !g.nameValid || !g.ageValid);

        if (invalidGuests.length > 0) {
            console.log('Guest validation failed:', invalidGuests);
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({
                    message: 'Invalid guest data',
                    detail: {
                        invalidGuests,
                        validAgeGroups: VALID_AGE_GROUPS,
                        allValidations: guestValidation
                    }
                })
            };
        }

        // DynamoDB Table check
        if (!process.env.RSVP_TABLE_NAME) {
            console.error('Missing RSVP_TABLE_NAME environment variable');
            throw new Error('Configuration error: Missing table name');
        }

        // Proceed with saving
        const submissionDate = new Date().toISOString();
        const item = {
            email: rsvpData.mainContact.email.trim().toLowerCase(),
            submissionDate,
            name: rsvpData.mainContact.name.trim(),
            age: rsvpData.mainContact.age,
            attendance: {
                friday: rsvpData.mainContact.attendingFriday,
                saturday: rsvpData.mainContact.attendingSaturday
            },
            totalGuests: rsvpData.guests.length,
            guests: rsvpData.guests.map(guest => ({
                name: guest.name.trim(),
                age: guest.age
            }))
        };

        console.log('Attempting to save item:', JSON.stringify(item, null, 2));

        const command = new PutItemCommand({
            TableName: process.env.RSVP_TABLE_NAME,
            Item: marshall(item)
        });

        await dynamoDB.send(command);
        console.log('Successfully saved to DynamoDB');

        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
                message: 'RSVP recorded successfully',
                confirmationId: submissionDate
            })
        };

    } catch (error) {
        console.error('Error processing request:', {
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
                detail: {
                    type: error.constructor.name,
                    stack: error.stack
                }
            })
        };
    }
};
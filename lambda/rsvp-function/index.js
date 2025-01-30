//UpdateRSVP_1
const { 
    DynamoDBClient, 
    PutItemCommand, 
    GetItemCommand,
    QueryCommand,
    UpdateItemCommand
} = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');

const dynamoDB = new DynamoDBClient({ region: 'us-east-1' });
const VALID_AGE_GROUPS = ['A', 'T', 'K', 'L', 'B'];

// Check for existing RSVP
const checkExistingRSVP = async (email) => {
    const params = {
        TableName: process.env.RSVP_TABLE_NAME,
        KeyConditionExpression: '#email = :email',
        ExpressionAttributeNames: {
            '#email': 'email'
        },
        ExpressionAttributeValues: marshall({
            ':email': email.toLowerCase()
        }),
        Limit: 1
    };

    const { Items } = await dynamoDB.send(new QueryCommand(params));
    return Items && Items.length > 0;
};

// RSVP submission handler
const submitHandler = async (rsvpData, corsHeaders) => {
    try {
        // Log the request body
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
        if (!rsvpData.mainContact?.email) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({
                    message: 'Email is required',
                    detail: {
                        validation: {
                            hasEmail: false
                        }
                    }
                })
            };
        }
        
        // Check for existing RSVP
        const exists = await checkExistingRSVP(rsvpData.mainContact.email);
        if (exists) {
            return {
                statusCode: 409,
                headers: corsHeaders,
                body: JSON.stringify({
                    message: 'An RSVP with this email already exists, please use the Update Your RSVP form below',
                    detail: {
                        email: rsvpData.mainContact.email,
                        suggestion: 'Please use the Update RSVP form to modify your existing RSVP'
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

// Handler for looking up RSVPs
const lookupHandler = async (email, corsHeaders) => {
    if (!process.env.RSVP_TABLE_NAME) {
        console.error('Missing RSVP_TABLE_NAME environment variable');
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                message: 'Configuration error: Missing table name'
            })
        };
    }

    try {
        // Use QueryCommand instead of GetItemCommand
        const params = {
            TableName: process.env.RSVP_TABLE_NAME,
            KeyConditionExpression: '#email = :email',
            ExpressionAttributeNames: {
                '#email': 'email'
            },
            ExpressionAttributeValues: marshall({
                ':email': email.toLowerCase()
            }),
            ScanIndexForward: false, // This will sort in descending order (newest first)
            Limit: 1 // We only want the most recent RSVP
        };

        const { Items } = await dynamoDB.send(new QueryCommand(params));
        
        if (!Items || Items.length === 0) {
            return {
                statusCode: 404,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'No RSVP found for this email' })
            };
        }

        const rsvpData = unmarshall(Items[0]);
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify(rsvpData)
        };
    } catch (error) {
        console.error('Error looking up RSVP:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                message: 'Error looking up RSVP',
                error: error.message
            })
        };
    }
};

// Handler for updating RSVPs
const updateHandler = async (rsvpData, corsHeaders) => {
    try {
        // Log the update request
        console.log('Update RSVP data:', JSON.stringify(rsvpData, null, 2));

        // Basic main contact validation
        if (!rsvpData.mainContact?.email) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({
                    message: 'Email is required',
                    detail: { validation: { hasEmail: false } }
                })
            };
        }

        // Complete main contact validation
        if (!rsvpData.mainContact?.name || !rsvpData.mainContact?.age ||
            (!rsvpData.mainContact?.attendingFriday && !rsvpData.mainContact?.attendingSaturday)) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({
                    message: 'Invalid main contact data',
                    detail: {
                        validation: {
                            hasName: !!rsvpData.mainContact?.name,
                            hasAge: !!rsvpData.mainContact?.age,
                            hasAttendanceDays: rsvpData.mainContact?.attendingFriday || 
                                             rsvpData.mainContact?.attendingSaturday
                        }
                    }
                })
            };
        }

        // Validate main contact age group
        if (!VALID_AGE_GROUPS.includes(rsvpData.mainContact.age)) {
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
        if (rsvpData.totalGuests && rsvpData.totalGuests !== rsvpData.guests.length) {
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
        console.log('Validating guest information');
        const guestValidation = rsvpData.guests.map((guest, index) => {
            const validation = {
                index,
                name: guest.name,
                age: guest.age,
                nameValid: !!guest.name?.trim(),
                ageValid: VALID_AGE_GROUPS.includes(guest.age)
            };
            console.log(`Guest ${index} validation:`, validation);
            return validation;
        });

        const invalidGuests = guestValidation.filter(g => !g.nameValid || !g.ageValid);

        if (invalidGuests.length > 0) {
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

        // Prepare update parameters
        const updateParams = {
            TableName: process.env.RSVP_TABLE_NAME,
            Key: marshall({
                email: rsvpData.mainContact.email.toLowerCase(),
                submissionDate: rsvpData.submissionDate || new Date().toISOString()
            }),
            UpdateExpression: 'SET #name = :name, age = :age, ' +
                              'attendance.#friday = :friday, ' +
                              'attendance.#saturday = :saturday, ' +
                              'totalGuests = :totalGuests, ' +
                              'guests = :guests, ' +
                              'lastUpdatedDate = :lastUpdatedDate',
            ExpressionAttributeNames: {
                '#name': 'name',
                '#friday': 'friday',
                '#saturday': 'saturday'
            },
            ExpressionAttributeValues: marshall({
                ':name': rsvpData.mainContact.name.trim(),
                ':age': rsvpData.mainContact.age,
                ':friday': rsvpData.mainContact.attendingFriday,
                ':saturday': rsvpData.mainContact.attendingSaturday,
                ':totalGuests': rsvpData.guests.length,
                ':guests': rsvpData.guests.map(guest => ({
                    name: guest.name.trim(),
                    age: guest.age
                })),
                ':lastUpdatedDate': new Date().toISOString()
            }),
            ReturnValues: 'ALL_NEW'
        };

        // Execute the update
        const command = new UpdateItemCommand(updateParams);
        const result = await dynamoDB.send(command);

        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
                message: 'RSVP updated successfully',
                confirmationId: unmarshall(result.Attributes).submissionDate
            })
        };
    } catch (error) {
        console.error('Error updating RSVP:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                message: 'Error updating RSVP',
                error: error.message,
                detail: {
                    type: error.constructor.name,
                    stack: error.stack
                }
            })
        };
    }
};

// Main handler
exports.handler = async (event) => {
    console.log('Event received:', JSON.stringify(event, null, 2));

    const corsHeaders = {
        'Access-Control-Allow-Origin': 'https://wadsworthreunion.com',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key',
        'Access-Control-Allow-Methods': 'OPTIONS,POST'
    };

    try {
        const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
        let response;

        // Handle different paths
        switch (event.path) {
            case '/rsvp/lookup':
                response = await lookupHandler(body.email, corsHeaders);
                break;
            case '/rsvp/update':
                response = await updateHandler(body, corsHeaders);
                break;
            default:
                response = await submitHandler(body, corsHeaders);
        }

        return response;
    } catch (error) {
        console.error('Error processing request:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                message: 'Error processing request',
                error: error.message
            })
        };
    }
};
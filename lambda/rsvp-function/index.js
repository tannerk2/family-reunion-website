const { DynamoDBClient, PutItemCommand } = require('@aws-sdk/client-dynamodb');
const { marshall } = require('@aws-sdk/util-dynamodb');

const dynamoDB = new DynamoDBClient({ region: 'us-east-1' }); // Explicitly set region

exports.handler = async (event) => {
    console.log('Received event:', JSON.stringify(event, null, 2));
    
    const corsHeaders = {
        'Access-Control-Allow-Origin': 'https://wadsworthreunion.com',
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
        console.log('Parsed RSVP data:', JSON.stringify(rsvpData, null, 2));
        
        const { mainContact, guests, totalGuests } = rsvpData;

        if (!mainContact.email || !mainContact.name || !guests || guests.length === 0) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'Missing required fields' })
            };
        }

        const isValidGuests = guests.every(guest => 
            guest.name && 
            typeof guest.age === 'string' && 
            parseInt(guest.age) >= 0 && 
            parseInt(guest.age) <= 120
        );

        if (!isValidGuests) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ message: 'Invalid guest data' })
            };
        }

        const submissionDate = new Date().toISOString();
        
        console.log('RSVP_TABLE_NAME:', process.env.RSVP_TABLE_NAME); // Debug log
        
        const item = {
            email: mainContact.email,
            submissionDate: submissionDate,
            name: mainContact.name,
            totalGuests: totalGuests,
            guests: guests.map(guest => ({
                name: guest.name,
                age: parseInt(guest.age, 10)
            }))
        };
        
        console.log('Marshalled item:', marshall(item)); // Debug log
        
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
        console.error('Stack trace:', error.stack); // Added stack trace
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ 
                message: 'Error processing RSVP',
                error: error.message,
                stack: error.stack // Include stack trace in response
            })
        };
    }
};
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as snowflake from "@pulumi/snowflake";
import * as crypto from "crypto";
import * as fs from "fs";
import * as awsx from "@pulumi/awsx";
import * as random from "@pulumi/random";
import {GenericSnowflake} from "./snowflake/SnowflakeGenericProvider";

///////////////////////////////////////////////////////////////////////////
// Default names for objects.
const functionInvocationRoleName = "SNOWFLAKE_CONNECTOR_INBOUND_REST_ROLE";
const connectorsDatabaseName = "SUNDECK_CONNECTORS";
const lambdaFunctionName = "mysql";
///////////////////////////////////////////////////////////////////////////

const identity = aws.getCallerIdentity({});
const currentRegion = pulumi.output(aws.getRegion()).name;
const currentAccount = identity.then(c => c.accountId);
const vpc = awsx.ec2.Vpc.getDefault();
export const vpcId = vpc.id;


// Create an AWS resource (S3 Bucket) !!NOTE!! that this is declared that it will delete on pulumi down.
const athenaResultsBucket = new aws.s3.BucketV2("athena.results", {forceDestroy: true});

// Ensure the bucket disables public access
const blockS3PublicAccess = new aws.s3.BucketPublicAccessBlock("athenaResultsBlockPublicAccess", {
    bucket: athenaResultsBucket.id,
    blockPublicAcls: true,
    blockPublicPolicy: true,
    ignorePublicAcls: true,
    restrictPublicBuckets: true,
});

// Create a database for our connector.
const db = new snowflake.Database("snowflake.database", {name: connectorsDatabaseName});
const schema = new snowflake.Schema("snowflake.schema", {database: db.name, name: "ATHENA"});

const athenaPolicy = new aws.iam.Policy("athena.policy", {policy: pulumi.all([athenaResultsBucket.arn]).apply((arn) => JSON.stringify({
            Version: "2012-10-17",
            Statement: [{
                "Sid": "VisualEditor0",
                "Effect": "Allow",
                "Action": [
                    "s3:ListMultipartUploadParts",
                    "s3:PutObject",
                    "s3:GetObject",
                    "s3:PutBucketNotification",
                    "s3:ListBucket"
                ],
                "Resource": arn + "/*"
            }],
        }))});
// Create a role that will be applied to api requests so that they can use Athena
const athenaRole = new aws.iam.Role("athena.role", {
    assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [        {
            "Effect": "Allow",
            "Principal": {
                "Service": "apigateway.amazonaws.com"
            },
            "Action": "sts:AssumeRole"
        }],}),
    managedPolicyArns: ["arn:aws:iam::aws:policy/AmazonAthenaFullAccess", athenaPolicy.arn],
});

// Create the api gateway we'll call.
const restApi = new aws.apigateway.RestApi("rest.api", {
        endpointConfiguration: {
            types: "REGIONAL"
        }
    }
);

// Create a role that will allow Snowflake to access our rest api. We are referring to a role we haven't yet created.
const snowflakeApiIntegration = pulumi.all([restApi.id, currentRegion, currentAccount]).apply(([restApiId, region, accountId]) => new snowflake.ApiIntegration("snowflake.apiIntegration", {
    apiAllowedPrefixes: [`https://${restApiId}.execute-api.${region}.amazonaws.com/`],
    apiAwsRoleArn: `arn:aws:iam::${accountId}:role/${functionInvocationRoleName}`,
    apiProvider: "aws_api_gateway",
    enabled: true,
}));

// Create an athena invocation resource
const athenaResource = new aws.apigateway.Resource("rest.athenaResource", {
    restApi: restApi.id,
    parentId: restApi.rootResourceId,
    pathPart: "athena",
});

// Enable the post method for the athena resource.
const postMethod = new aws.apigateway.Method("rest.athenaMethod", {
    restApi: restApi.id,
    resourceId: athenaResource.id,
    httpMethod: "POST",
    authorization: "AWS_IAM",
    requestParameters: {
        "method.request.querystring.action": false
    },
});

// Set the default response model to json.
const postMethod200Response = new aws.apigateway.MethodResponse("rest.athena200Response", {
    restApi: restApi.id,
    resourceId: athenaResource.id,
    httpMethod: postMethod.httpMethod,
    statusCode: "200",
    responseModels: {
        "application/json": "Empty"
    }
});

// define a integration operation that adds a header and converts a query string to a header.
const gatewayIntegration = new aws.apigateway.Integration("rest.requestIntegration", {
    restApi: restApi.id,
    resourceId: athenaResource.id,
    httpMethod: postMethod.httpMethod,
    integrationHttpMethod: "POST",
    type: "AWS",
    uri: pulumi.interpolate `arn:aws:apigateway:${currentRegion}:athena:path//`,
    credentials: athenaRole.arn,
    requestParameters: {
        "integration.request.header.Content-Type": "'application/x-amz-json-1.1'",
        "integration.request.header.X-Amz-Target": "method.request.querystring.action"
    },
    passthroughBehavior: "WHEN_NO_MATCH"
});

const athenaPostIntegrationResponse = new aws.apigateway.IntegrationResponse("rest.athenaPostIntegrationResponse", {
    restApi: restApi.id,
    resourceId: athenaResource.id,
    httpMethod: postMethod.httpMethod,
    statusCode: postMethod200Response.statusCode
}, {dependsOn: gatewayIntegration});

// deploy the rest api.
const apiDeployment = new aws.apigateway.Deployment("rest.deployment", {
    restApi: restApi.id,
    triggers: {
        redeployment: restApi.body.apply(body => JSON.stringify(body)).apply(toJSON => crypto.createHash('sha1').update(String(toJSON)).digest('hex')),
    },
}, {dependsOn: [postMethod200Response, athenaPostIntegrationResponse]});

// define a stage to deploy to.
const prodStage = new aws.apigateway.Stage("rest.prodStage", {
    deployment: apiDeployment.id,
    restApi: restApi.id,
    stageName: "prod",
});

// deploy a javascript request translator
const requestTranslator = new snowflake.Function("snowflake.requestTranslator", {
    name: "REQUEST_TRANSLATOR",
    arguments: [{name: "event", type: "object"}],
    database: db.name,
    schema: schema.name,
    language: "javascript",
    statement: pulumi.all( [athenaResultsBucket.bucket]).apply(([bucket]) =>
            `${file('snowflake/request_translator.js')}\nreturn translate_request(EVENT);`
                .replace('INSERTBUCKETNAMEHERE', bucket)),
    returnType: "object"
});

// deploy a javascript response translator
const responseTranslator = new snowflake.Function("snowflake.responseTranslator", {
    name: "RESPONSE_TRANSLATOR",
    arguments: [{name: "event", type: "object"}],
    database: db.name,
    schema: schema.name,
    language: "javascript",
    statement: `${file('snowflake/response_translator.js')}\nreturn translate_response(EVENT);`,
    returnType: "object"
});

// generate a mysql password
const mysqlPasswordGenerator = new random.RandomString("mysql.password", {length: 20, upper: true, special: false, lower: true})

// export the mysql password to the cli.
export const mysqlPassword = mysqlPasswordGenerator.result;

// create a mysql rds instance.
const mysql = new aws.rds.Instance("mysql.t3micro", {
    identifier: "mysql-snowflake-connector",
    allocatedStorage: 10,
    dbName: "mydb",
    engine: "mysql",
    engineVersion: "5.7",
    instanceClass: "db.t3.micro",
    parameterGroupName: "default.mysql5.7",
    password: mysqlPassword,
    skipFinalSnapshot: true,
    username: "root",
});

const athenaLambdaPolicy = new aws.iam.Policy("lambda.mysqlConnectorPolicy", {policy: pulumi.all([currentRegion, currentAccount, athenaResultsBucket.bucket]).apply(([region, account, bucket]) => JSON.stringify({
            Version: "2012-10-17",
            Statement: [
                {
                "Effect": "Allow",
                "Action": [
                    "secretsmanager:GetSecretValue",
                ],
                "Resource": `arn:aws:secretsmanager:${region}:${account}:secret:AthenaSecret*`
                },
                {
                    "Effect": "Allow",
                    "Action": [
                        "logs:CreateLogGroup",
                    ],
                    "Resource": `arn:aws:logs:${region}:${account}*`
                },
                {
                    "Effect": "Allow",
                    "Action": [
                        "logs:CreateLogStream",
                        "logs:PutLogEvents"
                    ],
                    "Resource": `arn:aws:logs:${region}:${account}:log-group:/aws/lambda/${lambdaFunctionName}:*`
                },
                {
                    "Effect": "Allow",
                    "Action": [
                        "athena:GetQueryExecution",
                        "s3:ListAllMyBuckets"
                    ],
                    "Resource": "*"
                },
                {
                    "Effect": "Allow",
                    "Action": [
                        "s3:GetObject",
                        "s3:ListBucket",
                        "s3:GetBucketLocation",
                        "s3:GetObjectVersion",
                        "s3:PutObject",
                        "s3:PutObjectAcl",
                        "s3:GetLifecycleConfiguration",
                        "s3:PutLifecycleConfiguration",
                        "s3:DeleteObject"
                    ],
                    "Resource": [
                        `arn:aws:s3:::${bucket}`,
                        `arn:aws:s3:::${bucket}/*`
                    ]
                },
                {
                    "Effect": "Allow",
                    "Action": [
                        "logs:CreateLogStream",
                        "logs:PutLogEvents"
                    ],
                    "Resource": `arn:aws:logs:${region}:${account}:log-group:/aws/lambda/${lambdaFunctionName}:*`
                },
                {
                    "Effect": "Allow",
                    "Action": [
                        "ec2:CreateNetworkInterface",
                        "ec2:DeleteNetworkInterface",
                        "ec2:DescribeNetworkInterfaces",
                        "ec2:DetachNetworkInterface"
                    ],
                    "Resource": "*"
                }
                ],
        }))});
// create a new role for the lambda that will be used as the
const athenaLambdaRole = new aws.iam.Role("lambda.mysqlConnectorRole", {
    namePrefix: "athenaMysqlLambda",
    assumeRolePolicy: JSON.stringify({
        "Version": "2012-10-17",
        "Statement": [
            {
                "Effect": "Allow",
                "Principal": {
                    "Service": "lambda.amazonaws.com"
                },
                "Action": "sts:AssumeRole"
            }
        ]
    }),
    managedPolicyArns: [athenaLambdaPolicy.arn]
});

const variables =  {
    "default": pulumi.interpolate `mysql://jdbc:mysql://root:${mysqlPassword}@${mysql.endpoint}/mydb`,
        "disable_spill_encryption": "false",
        "spill_bucket": athenaResultsBucket.bucket,
        "spill_prefix": "athena-spill",
}

const envName = `${lambdaFunctionName}_connection_string`;

// @ts-ignore
variables[envName]= pulumi.interpolate `mysql://jdbc:mysql://root:${mysqlPassword}@${mysql.endpoint}/mydb`;

const mysqlFunction = new aws.lambda.Function("athena.mysql.connector", {
    name: lambdaFunctionName,
    handler: "com.amazonaws.athena.connectors.mysql.MySqlMuxCompositeHandler",
    runtime: "java11",
    role: athenaLambdaRole.arn,
    s3Bucket: "awsserverlessrepo-changesets-1f9ifp952i9h0",
    s3Key: "577407151357/arn:aws:serverlessrepo:us-east-1:292517598671:applications-AthenaMySQLConnector-versions-2022.42.2/b7e4dd5b-a49b-4769-a1fd-69beb31d0bfc",
    timeout: 900,
    memorySize: 3008,
    ephemeralStorage: {
        size: 512
    },

    vpcConfig: {
        securityGroupIds: mysql.vpcSecurityGroupIds,
        subnetIds: vpc.publicSubnetIds
    },
    packageType: "Zip",
    environment: {
        variables: variables
    }
});


const allowLambdaInvoke = new aws.iam.RolePolicy("athena.lambda.invoke", {
    role: athenaRole,
    policy: pulumi.all([mysqlFunction.arn]).apply(([arn]) => JSON.stringify({
        Version: "2012-10-17",
        Statement: [{
            Action: ["lambda:InvokeFunction"],
            Effect: "Allow",
            Resource: arn,
        }],
    })),
});


const mysqlCatalog = new aws.athena.DataCatalog("athena.lambda.catalog", {
    name: mysqlFunction.name,
    description: "Mysql connection",
    parameters: {
        "metadata-function": mysqlFunction.arn,
        "record-function": mysqlFunction.arn,
    },
    type: "LAMBDA",
});

// Create a role that gives Snowflake access to our rest api.
const snowflakeExternalFunctionInvocationRole = new aws.iam.Role("rest.snowflakeInvocationRole", {
    name: functionInvocationRoleName,
    assumeRolePolicy: pulumi.all([snowflakeApiIntegration.apiAwsIamUserArn, snowflakeApiIntegration.apiAwsExternalId]).apply(([role, externalId]) => JSON.stringify({
        Version: "2012-10-17",
        Statement: [{
            "Sid": "",
            "Effect": "Allow",
            "Principal": {
                "AWS": role
            },
            "Action": "sts:AssumeRole",
            "Condition": {
                "StringEquals": {
                    "sts:ExternalId": externalId
                }
            }
        }],
    }))
});


const athenaExternalFunction = new GenericSnowflake("snowflake.athenaExternalFunction", {
    type: "EXTERNAL FUNCTION",
    name: "ATHENA_EXTERNAL_FUNCTION",
    database: db.name,
    schema: schema.name,
    args: [
        {name: "mode", type: "string"},
        {name: "sql", type: "string"},
        {name: "execution_id", type: "string"},
        {name: "starting_token", type: "string"},
        {name: "max_results_per_page", type: "integer"}
    ],
    theRest: pulumi.interpolate `
    returns variant
    API_INTEGRATION = "${snowflakeApiIntegration.name}"
    REQUEST_TRANSLATOR = "${requestTranslator.name}"
    RESPONSE_TRANSLATOR = "${responseTranslator.name}"
    CONTEXT_HEADERS = (CURRENT_TIMESTAMP)
    MAX_BATCH_ROWS = 1
    as 'https://${restApi.id}.execute-api.${currentRegion}.amazonaws.com/prod/athena';
    `
}, {deleteBeforeReplace: true, replaceOnChanges: ["*"]});

const queryFunction = new GenericSnowflake("snowflake.athenaQueryUDTF", {
    type: "FUNCTION",
    name: "QUERY_ATHENA",
    database: db.name,
    schema: schema.name,
    args: [
        {name: "sql", type: "string"},
        {name: "max_results_per_page", type: "integer"}
    ],
    theRest: pulumi.interpolate `returns table(data object) as $$
    ${file('snowflake/table_function_body.sql')}
    $$;`
}, {
    dependsOn: [athenaExternalFunction],
    deleteBeforeReplace: true,
    replaceOnChanges: ["*"]
});

const apiPolicy = new aws.apigateway.RestApiPolicy("rest.snowflakePolicy", {
  restApiId:  restApi.id,
  policy: pulumi.all([currentAccount, restApi.id, currentRegion, snowflakeExternalFunctionInvocationRole.name]).apply(([accountId, apiGatewayId, currentRegion, invocationRole]) => JSON.stringify({
    Version: "2012-10-17",
    Statement: [{
        "Effect": "Allow",
        "Principal": {
            "AWS": `arn:aws:sts::${accountId}:assumed-role/${invocationRole}/snowflake`
        },
        "Action": "execute-api:Invoke",
        "Resource": `arn:aws:execute-api:${currentRegion}:${accountId}:${apiGatewayId}/*`
    }]
  }))
}, {dependsOn: [snowflakeExternalFunctionInvocationRole, queryFunction]});


function file(fileName: string): string {
    return fs.readFileSync(fileName, 'utf8');
}

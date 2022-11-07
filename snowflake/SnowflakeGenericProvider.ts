import * as pulumi from "@pulumi/pulumi";
import {ID} from "@pulumi/pulumi/resource";
import { Snowflake } from 'snowflake-promise';


export interface SnowflakeResourceInputs {
    database: pulumi.Input<string>;
    schema: pulumi.Input<string>;
    name: pulumi.Input<string>;
    type: pulumi.Input<string>;
    args: pulumi.Input<FunctionArgumentInputs[]>;
    theRest: pulumi.Input<string>;
}

export interface FunctionArgumentInputs {
    name: pulumi.Input<string>,
    type: pulumi.Input<string>
}

interface FunctionArgument {
    name: string,
    type: string
}

interface SnowflakeInputs {
    database: string;
    schema: string;
    name: string;
    type: "FUNCTION" | "EXTERNAL FUNCTION";
    args: FunctionArgument[];
    theRest: string;
}

function createArgString(inputs: SnowflakeInputs ){
    return inputs.args.map(f => `${f.name} ${f.type}`).join(', ');
}

function dropArgString(inputs: SnowflakeInputs ){
    return inputs.args.map(f => f.type).join(', ');
}

function getId(inputs: SnowflakeInputs){
    return `"${inputs.database}"."${inputs.schema}"."${inputs.name}"`
}

class SnowflakeProvider implements pulumi.dynamic.ResourceProvider {
    connection: Snowflake | undefined = undefined;
    connected: boolean = false;

    async create(inputs: SnowflakeInputs) {
        await this.connectIfNotConnected();
        await runsql(this.connection, inputs.database, inputs.schema, `CREATE ${inputs.type} ${getId(inputs)}(${createArgString(inputs)}) ${inputs.theRest}`);
        const output = { id: getId(inputs) , outs: {database: inputs.database, schema: inputs.schema, name: inputs.name, type: inputs.type, theRest: inputs.theRest, args: inputs.args}};
        pulumi.log.debug(JSON.stringify(output));
        return output;
    }

    async connectIfNotConnected() {
        if(!this.connected) {
            pulumi.log.debug("Connecting.");
            const config = new pulumi.Config("snowflake");
            const account = config.require("account");
            const username = config.require("username");
            this.connection = new Snowflake({
                account: account,
                username: username,
                authenticator: "EXTERNALBROWSER"
            });
            await this.connection.connectAsync();
            pulumi.log.debug("Connected.");
            this.connected = true;
        }
    }

    async delete(id: ID, inputs: SnowflakeInputs) {
        await this.connectIfNotConnected();
        pulumi.log.info(`database: ${inputs.database} schema: ${inputs.schema}, args: ${(JSON.stringify(inputs.args))}, name: ${inputs.name}`);
        await runsql(this.connection, inputs.database, inputs.schema, `DROP FUNCTION ${getId(inputs)}(${dropArgString(inputs)}) `);
    }

}

const snowflakeGenericProvider= new SnowflakeProvider();

interface SnowflakeConfig {
    account: string;
    username: string;
}

export class GenericSnowflake extends pulumi.dynamic.Resource {
    constructor(name: string, args: SnowflakeResourceInputs, opts?: pulumi.CustomResourceOptions) {
        super(snowflakeGenericProvider, name, args, opts);
    }
}

async function runsql(connection: Snowflake | undefined, database: string, schema: string, sql: string) {
    pulumi.log.debug("runsql: " + sql );
    await connection?.execute(`USE "${database}"."${schema}"`);
    return connection?.execute(sql);
}





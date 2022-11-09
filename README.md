# A Source Connector Framework for Snowflake

This directory holds a pulumi deployment that allows Snowflake users to query alternative sources (specifically MySQL). You can learn more about this by reading our series of [blog posts](https://www.sundeck.io/blog/creating-a-source-connector-framework-for-snowflake) 

## Deploy AWS & Snowflake Assets
1. Ensure you're logged into AWS and your credentials are setup correctly. 
1. Install Pulumi ([instructions](https://www.pulumi.com/docs/get-started/install/))
1. Configure pulumi for first use.
   ```bash
   # Configure with local settings. You could also configure with Pulumi cloud but that takes more time. 
   pulumi login --local
   ```
1. Install node/npm ([instructions](https://nodejs.org/en/download/))
1. Clone the repository and install the required NPM packages.
   ```
   git clone https://github.com/sundeck-io/snowflake-connector-framework.git
   npm update
   ```
   
1. Configure your account & username for snowflake: 
   ```
   cd snowflake-connectors/athena
   pulumi config set snowflake:account YOURACCOUNTLOCATOR
   pulumi config set snowflake:username YOURSNOWFLAKEUSERNAME
   ```
1. Setup AWS & Snowflake 
   ```bash
   # During execution, pulumi will prompt you one or more times to login to Snowflake via browser.
   # Most of the operations are quick but the following take a while:
   #
   # *  Creation of a MySQL RDS instance takes 2-3 minutes.
   # *  Deployment of MySQL Athena connector Lambda takes 2-3 minutes.
   # 
   # Unfortunately, since the lambda connector needs info from the RDS instance post 
   # deploy (connection string), they have to run serially.  
   #
   # Note: If you see any Snowflake operations taking more than a couple seconds, that typically 
   # means you've missed a login window. Check all your tabs!
   #
   pulumi up -y
   ```
   
## Query MySQL (or any Athena source)
1. Go into Snowflake Snowsight (or your preferred SQL tool).
1. Execute a query in Snowflake against your new MySQL instance.
   ```sql
   use sundeck_connectors.athena;
   select * from table(query_athena($$ 
     select * from mysql.information_schema.tables
   $$, 100));
   ```
1. By default, all data comes back as a variant column. This is due to the fact that a UDTF needs to have schema declared at creation time. As such, our declared schema is a single variant column called `data`. If you want to make things more typed, you can create a view on top of your table function invocation. For example:
   ```sql
   CREATE VIEW mysql_information_schema_tables AS 
   SELECT 
       data:table_catalog::text AS table_catalog,
       data:table_schema::text AS table_schema,
       data:table_name::text AS table_name,
       data:table_type::text AS table_type
   FROM TABLE(query_athena($$ 
         SELECT * FROM mysql.information_schema.tables
       $$, 100)); 
   ```

## Frequently Asked Questions
<dl>
   <dt>How does this all work?</dt>
   <dd>See our <a href="https://www.sundeck.io/blog/creating-a-source-connector-framework-for-snowflake">Blog post</a> on the topic!</dd>
   <dt>What is Pulumi?</dt>
   <dd>Pulumi is a infrastructure automation tool, similar to Terraform or AWS CloudFormation.</dd>
   <dt>Why use Pulumi?</dt>
   <dd>In order to deploy an external function, there is some back and forth between AWS and Snowflake. (You need take information from each and give it to the other). Rather than make people go through a bunch of steps, Pulumi allows us to automatically move the configuration between the two systems to make it easier to setup an external function.</dd>
    <dt>What if I want to configure things manually?</dt>
    <dd>Pulumi is largely declarative. Most of the deployment code should readable even if you've never used Pulumi</dd>
   <dt>What does Sundeck do?</dt>
<dd>We're working on some new ways to enhance Snowflake. More coming soon. Go to our [website](https://sundeck.io) and sign up for our mailing list to hear more as we progress.</dd>
</dl>


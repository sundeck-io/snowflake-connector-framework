# Querying MySQL (or any Athena source) from Snowflake

This directory holds a pulumi deployment that allows Snowflake users to query MySQL. To deploy:

1. Ensure you're logged into AWS and your credentials are setup correctly. 
1. Install Pulumi ([instructions](https://www.pulumi.com/docs/get-started/install/))
1. Install node/npm ([instructions](https://nodejs.org/en/download/))
1. Clone the repository and install the required NPM packages.
   ```
   git clone https://github.com/sundeck-io/snowflake-connectors.git
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
   # During execution, it will prompt you one or more times to log into Snowflake via your browser.
   # Most of the operations are quick but the creation of a MySQL RDS instance can take a little while (1-2 minutes)  
   pulumi up -y
   ```
1. Go into Snowflake Snowsight (or your preferred SQL tool).
1. Execute a query in Snowflake against your new MySQL instance.
   ```sql
   use snowflake_connectors.athena;
   select count(*) from table(query_athena($$ select count(*) from mysql.information_schema.tables$$));
   ```

How does this all work?
: See our [blog post](https://sundeck.io/blog/query_mysql_with_snowflake) on the topic!

What is Pulumi?
: Pulumi is a infrastructure automation tool, similar to Terraform or AWS CloudFormation.

Why use Pulumi?
: In order to deploy an external function, there is some back and forth between AWS and Snowflake. (You need take information from each and give it to the other). Rather than make people go through a bunch of steps, Pulumi allows us to automatically move the configuration between the two systems to make it easier to setup an external function.

What if I want to configure things manually?
: Pulumi is largely declarative. Most of the deployment code should readable even if you've never used Pulumi

What does Sundeck do?
: We're working on some new ways to enhance Snowflake. More coming soon. Go to our [website](https://sundeck.io) and sign up for our mailing list to hear more as we progress.


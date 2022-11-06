
function translate_request(EVENT) {
  if(!EVENT.body.data[0][1]) {
    throw new Error("Mode must be provided.");
  }
  let row = EVENT.body.data[0][0];
  let mode = EVENT.body.data[0][1].toLowerCase();
  let sql = EVENT.body.data[0][2];
  let execution_id = EVENT.body.data[0][3];
  let starting_token = EVENT.body.data[0][4];
  let max_results_per_page = EVENT.body.data[0][5];

  switch(mode) {

    case "submit":
      if(!sql || execution_id || starting_token) {
        throw new Error("A non-null SQL argument must be passed for Submission.");
      }
      return {
        "translatorData": {"mode" : mode},
        "urlSuffix" : "?action=AmazonAthena.StartQueryExecution",
        "body": { "QueryString": sql,
          "ClientRequestToken": EVENT.contextHeaders["sf-context-current-timestamp"] + "xxxxxxxxxxxxxxxx",
          "ResultConfiguration": {"OutputLocation": "s3://INSERTBUCKETNAMEHERE/"}
        },
      };
    case "pending":
      if(sql || !execution_id || starting_token) {
        throw new Error("Only execution id should be passed for pending." + sql + " " + execution_id + " " + starting_token);
      }
      return {
        "urlSuffix" : "?action=AmazonAthena.GetQueryExecution",
        "body": {"QueryExecutionId": execution_id},
        "translatorData": {"mode" : mode, "execution_id": execution_id},
      };
    case "first_page":
      if(sql || !execution_id || starting_token) {
        throw new Error("First page should have execution id but no sql or starting token.");
      }
      return {
        "urlSuffix" : "?action=AmazonAthena.GetQueryResults",
        "translatorData": {"mode" : mode, "execution_id": execution_id},
        "body": {
          "QueryExecutionId": execution_id,
          "MaxResults": max_results_per_page
        }};

    case "subsequent_page":
      if(sql || !execution_id || !starting_token) {
        throw new Error("Next page should have execution id and starting token but no sql.");
      }
      return {
        "urlSuffix" : "?action=AmazonAthena.GetQueryResults",
        "translatorData": {"mode" : mode, "execution_id": execution_id},
        "body": {
          "QueryExecutionId": execution_id,
          "MaxResults": max_results_per_page,
          "NextToken": starting_token
        },
      };

    default:
      throw new Error("Unknown mode submitted.");
  }
}

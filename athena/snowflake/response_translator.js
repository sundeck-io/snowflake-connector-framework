
function translate_response(EVENT) {
  try {
    let mode = EVENT.translatorData.mode;
    switch(mode) {
      case "submit":
        return {
          "body": { data: [[0, {execution_id: EVENT.body.QueryExecutionId, mode: "pending"}]]}
        }
      case "pending":
        switch(EVENT.body.QueryExecution.Status.State) {
          case "SUCCEEDED":
            return {
              "body": { data: [[0, {execution_id: EVENT.translatorData.execution_id, mode: "first_page"}]]}
            }
          case "FAILED":
            throw new Error(EVENT.body.QueryExecution.Status.StateChangeReason);
        }
        // let us try again. ideally we would use await here but it is not clear on how to do this inside of snowflake.
        //await new Promise(r => setTimeout(r, 75));
        return {
          "body": { data: [[0, {execution_id: EVENT.translatorData.execution_id, mode: "pending"}]]}
        }
      case "first_page":
      case "subsequent_page":
        const body = EVENT.body;
        let records = new Array();
        let columns = body.ResultSet.ColumnInfos;
        for (let i = mode == "subsequent_page" ? 0 : 1; i < body.ResultSet.Rows.length; i++) {
          let row = body.ResultSet.Rows[i].Data;
          let o = new Object();
          for(let h = 0; h < columns.length; h++) {
            let name = columns[h].Name;
            let value = row[h].VarCharValue;
            switch(columns[h].Type) {
              case "boolean":
                value = Boolean(value);
                break;
              case "tinyint":
              case "smallint":
              case "integer":
                value = parseInt(value);
                break;
            }

            o[name] = value;
          }

          records.push(o);
        }
        let data = {
          mode: "subsequent_page",
          execution_id: EVENT.translatorData.execution_id,
          next: body.NextToken,
          data: records
        };
        return {
          "body": { data: [[0, data]]}
        };
      default:
        return {
          "body": { data: [[0, EVENT.body]] }
        }
    }
  } catch(err) {
    //throw new Error(err.message + JSON.stringify(EVENT.body))
    throw new Error(err.message)    ;
  }
}
